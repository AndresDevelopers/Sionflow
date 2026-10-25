import test from "node:test";
import assert from "node:assert/strict";
import { classifyChange, protectedChanges, headApprovalComment } from "./ci-policy-guard.mjs";

test("new test is allowed without changing an existing contract", () => {
  assert.equal(classifyChange({ filename: "src/lib/new.test.ts", status: "added" }), null);
});

test("modified or deleted test is protected, including Node and Playwright tests", () => {
  for (const filename of ["src/lib/a.test.tsx", "src/lib/b.spec.mts", "scripts/vps-cron.spec.mjs", "tests/e2e/auth.spec.ts"]) {
    assert.equal(classifyChange({ filename, status: "modified" }), "tests");
    assert.equal(classifyChange({ filename, status: "removed" }), "tests");
  }
});

test("renaming a test to a normal file does not avoid protection", () => {
  assert.equal(classifyChange({ filename: "src/lib/normal.ts", previous_filename: "src/lib/security.test.ts", status: "renamed" }), "tests");
});

test("existing mocks, fixtures and snapshots are protected", () => {
  for (const filename of ["tests/mocks/supabase.ts", "tests/fixtures/data.json", "src/lib/__mocks__/db.ts", "src/lib/__snapshots__/ui.snap"]) {
    assert.equal(classifyChange({ filename, status: "modified" }), "tests");
  }
});

test("protected CI paths require approval even when newly added", () => {
  for (const filename of [".kilo/agents/reviewer.md", "scripts/setup-hooks.js", "vitest.config.ts", "firestore.rules", ".github/workflows/new.yml", ".github/workflows/ci.yml", "package.json", "pnpm-lock.yaml", "vitest.config.mts", "vitest.contract.config.mts", "vitest.setup.ts", "playwright.config.ts", "scripts/ci-policy-guard.mjs", "scripts/ci-pr-reuse-gate.mjs", "scripts/check-coverage.mjs", "eslint.config.mjs", ".gitleaks.toml", "AGENTS.md", "RULES.md", ".github/instructions/agents.instructions.md"]) {
    assert.equal(classifyChange({ filename, status: "added" }), "config");
    assert.equal(classifyChange({ filename, status: "modified" }), "config");
  }
});

test("normal application code is not restricted by this policy", () => {
  assert.equal(classifyChange({ filename: "src/app/page.tsx", status: "modified" }), null);
  assert.equal(classifyChange({ filename: "src/lib/new.ts", status: "added" }), null);
});

test("group protected files without losing their statuses", () => {
  const rows = protectedChanges([
    { filename: "src/app/page.tsx", status: "modified" },
    { filename: "src/lib/a.spec.ts", status: "removed" },
    { filename: "package.json", status: "modified" },
  ]);
  assert.deepEqual(rows.map((item) => item.category), ["tests", "config"]);
});

test("head-bound approval must match the exact current SHA", () => {
  const sha = "a".repeat(40);
  assert.equal(headApprovalComment("CI-POLICY-APPROVE " + sha, sha), true);
  assert.equal(headApprovalComment("CI-POLICY-APPROVE " + "b".repeat(40), sha), false);
  assert.equal(headApprovalComment("Extra text CI-POLICY-APPROVE " + sha, sha), false);
});
