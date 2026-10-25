/**
 * Trusted PR policy. Run ONLY from the base branch on pull_request_target.
 * Never checkout or execute an untrusted pull request in this workflow.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_PATH = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/i;
const TEST_SUPPORT = /(?:^tests\/(?:mocks|fixtures|__snapshots__)\/|\/__(?:mocks|fixtures|snapshots)__\/|\.snap$)/i;
const E2E_PATH = /^tests\/e2e\//;
const PROTECTED_CONFIG = [
  /^\.github\/dependabot\.yml$/,
  /^\.github\/agents\//,
  /^\.kilo\//,
  /^scripts\/setup-hooks\.js$/,
  /^scripts\/(?:local-regression-gate|cloud-regression-gate|ci-policy-guard)(?:\.spec)?\.mjs$/,
  /^(?:firebase\.json|firestore\.rules|storage\.rules)$/,
  /^vitest\.config\.ts$/,
  /^src\/test-support\//,

  /^\.github\/workflows\//,
  /^\.githooks\//,
  /^scripts\/local-regression-gate(?:\.spec)?\.mjs$/,
  /^scripts\/cloud-regression-gate(?:\.spec)?\.mjs$/,
  /^scripts\/ci-local-guard-policy\.spec\.mjs$/,
  /^scripts\/run-waiter-e2e\.mjs$/,
  /^\.github\/CODEOWNERS$/,
  /^\.github\/instructions\//,
  /^(?:AGENTS\.md|RULES\.md)$/,
  /^scripts\/ci-policy-guard(?:\.spec)?\.mjs$/,
  /^scripts\/ci-pr-reuse-gate\.mjs$/,
  /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc)$/,
  /^(?:vitest(?:\.contract)?\.config\.[cm]?[jt]s|vitest\.setup\.[cm]?[jt]s|playwright\.config\.[cm]?[jt]s)$/,
  /^(?:eslint\.config\.[cm]?[jt]s|\.eslintrc\.json|\.gitleaks\.toml|tsconfig\.json|sonar-project\.properties)$/,
  /^scripts\/(?:check-coverage|generate-database-types|run-gitleaks|install-gitleaks|vercel-build)\.mjs$/,
];

export function classifyChange({ filename, previous_filename, status }) {
  const paths = [filename, previous_filename].filter((p) => typeof p === "string");
  if (paths.some((path) => PROTECTED_CONFIG.some((pattern) => pattern.test(path)))) {
    return "config";
  }
  if (status !== "added" && paths.some((path) => TEST_PATH.test(path) || TEST_SUPPORT.test(path) || E2E_PATH.test(path))) {
    return "tests";
  }
  return null;
}

export function protectedChanges(files) {
  return files.map((file) => ({ ...file, category: classifyChange(file) }))
    .filter((file) => file.category !== null);
}

export function headApprovalComment(body, headSha) {
  return typeof body === "string" && body.trim() === "CI-POLICY-APPROVE " + headSha;
}

function requiredEnv(key) {
  const value = process.env[key];
  if (!value) throw new Error("Missing " + key);
  return value;
}

async function getJson(apiPath) {
  const response = await fetch("https://api.github.com" + apiPath, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + requiredEnv("GH_TOKEN"),
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error("GitHub API " + response.status + ": " + apiPath);
  return response.json();
}

async function allPages(apiPath, limit = 35) {
  const items = [];
  for (let page = 1; page <= limit; page++) {
    const response = await getJson(apiPath + (apiPath.includes("?") ? "&" : "?") + "per_page=100&page=" + page);
    if (!Array.isArray(response)) throw new Error("Invalid paginated response: " + apiPath);
    items.push(...response);
    if (response.length < 100) return items;
  }
  throw new Error("Pagination safety limit exceeded for " + apiPath);
}

async function maintainer(login, repository, permissionCache) {
  if (!login) return false;
  if (!permissionCache.has(login)) {
    const result = await getJson("/repos/" + repository + "/collaborators/" + encodeURIComponent(login) + "/permission");
    permissionCache.set(login, result.permission === "admin" || result.permission === "maintain");
  }
  return permissionCache.get(login);
}

async function approvedLabel(label, labels, timeline, repository, cache) {
  if (!labels.some((entry) => entry.name === label)) return false;
  const lastEvent = [...timeline].reverse().find((entry) =>
    (entry.event === "labeled" || entry.event === "unlabeled") && entry.label?.name === label
  );
  return lastEvent?.event === "labeled" && await maintainer(lastEvent.actor?.login, repository, cache);
}

async function main() {
  const repository = requiredEnv("GITHUB_REPOSITORY");
  const prNumber = Number(requiredEnv("PR_NUMBER"));
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository) || !Number.isSafeInteger(prNumber) || prNumber < 1) {
    throw new Error("Invalid repository or PR number");
  }
  const basePath = "/repos/" + repository;
  const pr = await getJson(basePath + "/pulls/" + prNumber);
  if (!["master", "main", "develop"].includes(pr.base?.ref)) throw new Error("Unexpected PR base: " + pr.base?.ref);
  if (!/^[0-9a-f]{40}$/.test(pr.head?.sha || "")) throw new Error("Invalid PR head SHA");

  const files = await allPages(basePath + "/pulls/" + prNumber + "/files");
  const changes = protectedChanges(files);
  if (changes.length === 0) {
    console.log("PR #" + prNumber + ": no protected tests or CI configuration changed.");
    return;
  }
  console.log("PR #" + prNumber + " modifies protected paths:");
  for (const file of changes) console.log("  [" + file.category + "] " + file.status + ": " + (file.previous_filename ? file.previous_filename + " -> " : "") + file.filename);

  const labelsNeeded = [...new Set(changes.map((file) => file.category === "tests" ? "tests-change-approved" : "ci-config-change-approved"))];
  const issue = await getJson(basePath + "/issues/" + prNumber);
  const timeline = await allPages(basePath + "/issues/" + prNumber + "/timeline");
  const comments = await allPages(basePath + "/issues/" + prNumber + "/comments");
  const cache = new Map();
  const missing = [];
  for (const label of labelsNeeded) {
    if (!await approvedLabel(label, issue.labels || [], timeline, repository, cache)) missing.push(label);
  }

  const approvals = comments.filter((comment) => headApprovalComment(comment.body, pr.head.sha));
  let approvedHead = false;
  for (const comment of approvals) {
    if (await maintainer(comment.user?.login, repository, cache)) {
      approvedHead = true;
      break;
    }
  }
  if (missing.length || !approvedHead) {
    throw new Error([
      "Protected files need explicit authorization from a repository admin/maintainer.",
      missing.length ? "Missing authorized label(s): " + missing.join(", ") : "Required labels: verified.",
      !approvedHead ? "A maintainer must post the exact comment: CI-POLICY-APPROVE " + pr.head.sha : "Head-bound approval: verified.",
      "After any new commit, post a fresh SHA-bound approval comment.",
    ].join("\n"));
  }
  console.log("PR #" + prNumber + ": protected changes approved for " + pr.head.sha);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error("::error::" + error.message); process.exitCode = 1; });
}
