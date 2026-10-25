/**
 * Tests for the user-facing changelog generator.
 * Run with: node --test scripts/generate-changelog.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseGitLog,
  isUserFacingCommit,
  isInternalPath,
  detectModules,
  humanizeCommitSubject,
  stripLeadingVerb,
  createFriendlyChanges,
  normalizeCategorizedChanges,
  flattenLocalized,
  buildNormalizedCommitSet,
  isLowQualityChangelog,
  looksMostlyEnglish,
  looksMostlySpanish,
} = require('./generate-changelog.js');

const srcFile = (path) => ({ status: 'M', path });

test('parseGitLog keeps each commit message and its touched files', () => {
  const raw = [
    '===COMMIT===',
    'feat: add interviews',
    '',
    '===FILES===',
    'A\tsrc/app/(main)/interviews/page.tsx',
    'M\tsrc/app/(main)/members/page.tsx',
    '',
    '===COMMIT===',
    'chore: bump deps',
    '===FILES===',
    'M\tpackage.json',
  ].join('\n');

  const commits = parseGitLog(raw);

  assert.equal(commits.length, 2);
  assert.equal(commits[0].message, 'feat: add interviews');
  assert.deepEqual(
    commits[0].files.map((f) => f.path),
    ['src/app/(main)/interviews/page.tsx', 'src/app/(main)/members/page.tsx']
  );
  assert.equal(commits[1].files[0].path, 'package.json');
});

test('internal paths are never treated as user-facing', () => {
  assert.equal(isInternalPath('scripts/generate-changelog.js'), true);
  assert.equal(isInternalPath('src/app/(main)/members/__tests__/page.test.tsx'), true);
  assert.equal(isInternalPath('package.json'), true);
  assert.equal(isInternalPath('eslint.config.mjs'), true);
  assert.equal(isInternalPath('README.md'), true);
  assert.equal(isInternalPath('public/changelog.json'), true);
  assert.equal(isInternalPath('src/app/(main)/members/page.tsx'), false);
  assert.equal(isInternalPath('src/locales/es.json'), false);
});

test('developer commits are filtered out of the changelog', () => {
  assert.equal(
    isUserFacingCommit({ message: 'chore: bump deps and update ESLint config', files: [srcFile('package.json')] }),
    false
  );
  assert.equal(
    isUserFacingCommit({ message: 'docs: update readme', files: [srcFile('README.md')] }),
    false
  );
  assert.equal(
    isUserFacingCommit({ message: 'test: mock JSDOM scrollTo', files: [srcFile('src/test-support/setup.ts')] }),
    false
  );
  assert.equal(
    isUserFacingCommit({ message: 'refactor: split member form', files: [srcFile('src/components/members/member-form.tsx')] }),
    false
  );
  assert.equal(
    isUserFacingCommit({ message: 'chore: auto-update changelog [skip ci]', files: [] }),
    false
  );
  assert.equal(
    isUserFacingCommit({
      message: 'feat: add temple recommend tracking and expiry notifications',
      files: [
        srcFile('src/components/members/member-form.tsx'),
        srcFile('src/app/api/members/__tests__/route.test.ts'),
      ],
    }),
    true
  );
  assert.equal(
    isUserFacingCommit({
      message: 'fix(birthdays): use Ecuador calendar in birthdays page',
      files: [srcFile('src/components/birthdays/birthdays-dashboard-card.tsx')],
    }),
    true
  );
});

test('fallback keeps Spanish and English strictly separate', () => {
  const commits = [
    {
      message: 'feat: add temple recommend tracking and expiry notifications',
      files: [srcFile('src/app/(main)/members/page.tsx')],
    },
    {
      message: 'fix(birthdays): use Ecuador calendar in birthdays page',
      files: [srcFile('src/components/birthdays/birthdays-utils.ts')],
    },
    {
      message: 'feat: allow exporting the council report as a file',
      files: [srcFile('src/app/(main)/council/page.tsx')],
    },
  ];

  const changes = createFriendlyChanges(commits);
  const esItems = flattenLocalized(changes.es);
  const enItems = flattenLocalized(changes.en);

  assert.ok(esItems.length > 0);
  assert.equal(esItems.length, enItems.length);

  for (const item of esItems) {
    assert.equal(/\b(add|fix|update|allow|export|report|calendar|temple)\b/i.test(item), false, `English leaked into ES: ${item}`);
    assert.equal(looksMostlyEnglish(item), false, `ES bullet looks English: ${item}`);
    assert.equal(/^(actualizaci[oó]n|update|fix|feat)\s*:/i.test(item), false);
  }

  for (const item of enItems) {
    assert.equal(looksMostlySpanish(item), false, `Spanish leaked into EN: ${item}`);
  }

  assert.equal(
    changes.en.added[0],
    'We added temple recommend tracking and expiry notifications.'
  );

  assert.ok(changes.es.added.length >= 1);
  assert.ok(changes.es.fixed.length >= 1);
  assert.ok(changes.en.added.length >= 1);
  assert.ok(changes.en.fixed.length >= 1);
});

test('fallback drops internal-only commits instead of publishing them', () => {
  const changes = createFriendlyChanges([
    { message: 'chore: bump dependencies', files: [srcFile('package.json')] },
    { message: 'ci: cache node modules', files: [srcFile('.github/workflows/ci.yml')] },
  ]);

  assert.equal(flattenLocalized(changes.es).length, 0);
  assert.equal(flattenLocalized(changes.en).length, 0);
  assert.deepEqual(normalizeCategorizedChanges({ es: {}, en: {} }), { es: {}, en: {} });
});

test('humanize and area detection produce readable fallback copy', () => {
  assert.equal(
    humanizeCommitSubject('fix(birthdays): use Ecuador calendar in birthdays-utils.ts'),
    'use Ecuador calendar'
  );
  assert.deepEqual(detectModules([srcFile('src/app/(main)/ministering/page.tsx')]), ['ministering']);
  assert.deepEqual(detectModules([srcFile('src/components/member-form.tsx')]), []);
  assert.equal(stripLeadingVerb('add temple recommend tracking', 'added'), 'temple recommend tracking');
  assert.equal(stripLeadingVerb('fixed the login loop', 'fixed'), 'the login loop');
  assert.equal(stripLeadingVerb('temple recommend tracking', 'added'), 'temple recommend tracking');
});

test('quality gate rejects mixed-language and raw commit output', () => {
  const normalized = buildNormalizedCommitSet([
    { message: 'feat: add temple recommend tracking and expiry notifications', files: [] },
  ]);

  const mixed = {
    es: { added: ['Hemos añadido: add temple recommend tracking and expiry notifications.'] },
    en: { added: ['We added temple recommend tracking and expiry notifications.'] },
  };
  assert.equal(isLowQualityChangelog(mixed, normalized), true);

  const raw = {
    es: { added: ['add temple recommend tracking and expiry notifications'] },
    en: { added: ['add temple recommend tracking and expiry notifications'] },
  };
  assert.equal(isLowQualityChangelog(raw, normalized), true);

  // Both languages must describe the same number of changes.
  const unmatched = {
    es: {
      added: [
        'Ahora puedes registrar quién tiene recomendación para el templo y cuándo vence.',
        'Puedes ver en Miembros quién necesita renovar su recomendación este mes.',
      ],
    },
    en: { added: ['You can now record who has a temple recommend and when it expires.'] },
  };
  assert.equal(isLowQualityChangelog(unmatched, normalized), true);

  const good = {
    es: {
      added: ['Ahora puedes registrar quién tiene recomendación para el templo y cuándo vence, con avisos antes del vencimiento.'],
    },
    en: {
      added: ['You can now record who has a current temple recommend and when it expires, with a warning before the expiry date.'],
    },
  };
  assert.equal(isLowQualityChangelog(good, normalized), false);
});
