import test from "node:test";
import assert from "node:assert/strict";
import { parseNameStatusZ, planChanges, isProtectedGuardPath, checkPrePushInput, approvalFingerprint, approvalMatches, gateCommands } from "./local-regression-gate.mjs";

const sha = "a".repeat(40);
test("diff NUL handles renames and modifications", () => {
  assert.deepEqual(parseNameStatusZ(Buffer.from("R100\0old.test.ts\0new.test.ts\0M\0src/app/page.tsx\0")).map(x => x.status), ["R100", "M"]);
});
test("historical changes to existing tests cannot be skipped", () => {
  const p = planChanges([{ status: "M", path: "src/lib/auth.test.ts", previousPath: null }, { status: "A", path: "src/lib/new.test.ts", previousPath: null }]);
  assert.equal(p.modifiedTests.length, 1);
  assert.equal(p.shouldTest, true);
});
test("guard files, Firebase rules and agent policies are protected", () => {
  for (const p of ["AGENTS.md", "firestore.rules", "storage.rules", ".github/workflows/ci.yml", ".kilo/agents/reviewer.md", "scripts/setup-hooks.js"])
    assert.equal(isProtectedGuardPath(p), true, p);
});
test("pre-push accepts one feature branch but blocks branch deletion and stale HEAD", () => {
  const ok = "refs/heads/fix " + sha + " refs/heads/fix " + "0".repeat(40);
  assert.equal(checkPrePushInput(ok, sha).production, false);
  assert.throws(() => checkPrePushInput("refs/heads/fix " + "0".repeat(40) + " refs/heads/fix " + sha, sha));
  assert.throws(() => checkPrePushInput(ok, "b".repeat(40)));
});
test("approval is bound to the base, head and exact protected diff", () => {
  const input = { baseSha: sha, headSha: "b".repeat(40), testChanges: [{ status:"M",path:"src/lib/a.test.ts" }], testPatch:"patch" };
  const fingerprint = approvalFingerprint(input);
  const expected = { version: 1, baseSha: input.baseSha, headSha: input.headSha, fingerprint };
  assert.equal(approvalMatches(JSON.stringify(expected), expected), true);
  assert.notEqual(fingerprint, approvalFingerprint({ ...input, testPatch: "other" }));
});
test("strict gate includes role, lint, audit, build; preflight still runs tests", () => {
  const strict = gateCommands(true, true).map(x => x.args.join(" "));
  assert.ok(strict.some(x => x === "test:roles"));
  assert.ok(strict.some(x => x === "lint"));
  assert.ok(strict.some(x => x.startsWith("audit ")));
  assert.ok(strict.some(x => x.includes("next build")));
  assert.ok(gateCommands(false, true).some(x => x.args.join(" ") === "test"));
});
