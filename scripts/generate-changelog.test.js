const assert = require('assert');
const {
  createFriendlyChanges,
  buildNormalizedCommitSet,
  isLikelyRaw,
} = require('./generate-changelog');

const commits = [
  'feat: add dashboard widget',
  'fix(auth): handle timeout on login',
];

const friendly = createFriendlyChanges(commits);
assert.ok(Array.isArray(friendly.es));
assert.ok(Array.isArray(friendly.en));
assert.ok(friendly.es.length > 0);
assert.ok(friendly.en.length > 0);
assert.ok(friendly.es.every((item) => !commits.includes(item)));
assert.ok(friendly.en.every((item) => !commits.includes(item)));

const normalized = buildNormalizedCommitSet(commits);
assert.strictEqual(isLikelyRaw(commits, normalized), true);
assert.strictEqual(isLikelyRaw(['Update: Added dashboard widget.'], normalized), false);
