import test from "node:test";
import assert from "node:assert/strict";
import { isExpectedOrigin, advertisedMaster, gateMode } from "./cloud-regression-gate.mjs";
test("only the official Sionflow repository can be trusted", () => {
  assert.equal(isExpectedOrigin("https://github.com/AndresDevelopers/Sionflow.git"), true);
  assert.equal(isExpectedOrigin("git@github.com:AndresDevelopers/Sionflow.git"), true);
  assert.equal(isExpectedOrigin("https://github.com/other/Sionflow.git"), false);
  assert.equal(isExpectedOrigin("https://github.com/AndresDevelopers/KVTemplate"), false);
});
test("remote main SHA must be a single valid ref", () => {
  const sha="a".repeat(40);
  assert.equal(advertisedMaster(sha+"  refs/heads/main\n"),sha);
  assert.throws(()=>advertisedMaster(sha+"  refs/heads/master\n"));
  assert.throws(()=>advertisedMaster(""));
});
test("cloud mode selection does not certify a dirty initial checkout", () => {
  assert.equal(gateMode("--prepare", false),"--preflight");
  assert.equal(gateMode("--prepare", true),"--check-worktree");
  assert.equal(gateMode("--verify", false),"--check");
  assert.equal(gateMode("--verify", true),"--check-worktree");
});
