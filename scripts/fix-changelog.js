#!/usr/bin/env node
/**
 * One-off script to regenerate changelog entries for all missing dates.
 * 
 * Reads the last changelog entry date, collects all non-merge commits since then,
 * groups them by date, and generates entries for each missing day.
 */

const path = require('path');
const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env') });

const { execSync } = require('child_process');
const fs = require('fs');
const https = require('https');

const CHANGELOG_FILE = path.join(ROOT, 'public', 'changelog.json');
const VERSION_FILE = path.join(ROOT, 'public', 'version.json');
const PACKAGE_FILE = path.join(ROOT, 'package.json');

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function extractSubject(message) {
  return message.split('\n')[0].trim();
}
function stripConventionalPrefix(subject) {
  return subject.replace(/^\s*[a-z]+(\([^)]+\))?(!)?\s*:\s*/i, '');
}
function ensureSentence(text) {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const capitalized = trimmed[0].toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function createFriendlyChanges(commits) {
  const subjects = commits.map(extractSubject).filter(Boolean);
  const cleaned = subjects.map(stripConventionalPrefix);
  const limited = cleaned.slice(0, 6);

  const es = limited.map((item) => {
    const base = item || 'Cambios internos';
    return `Actualización: ${ensureSentence(base)}`;
  });

  const en = limited.map((item) => {
    const base = item || 'Internal updates';
    return `Update: ${ensureSentence(base)}`;
  });

  return { es, en };
}

function normalizeText(value) {
  return value.toLowerCase().replace(/[\s\W_]+/g, '');
}
function hasConventionalPrefix(text) {
  return /^\s*(feat|fix|chore|docs|refactor|perf|test|build|ci|style|revert)(\([^)]+\))?(!)?\s*:\s*/i.test(text);
}
function buildNormalizedCommitSet(commits) {
  const subjects = commits.map(extractSubject);
  const cleaned = subjects.map(stripConventionalPrefix);
  const combined = [...commits, ...subjects, ...cleaned].filter(Boolean);
  return new Set(combined.map(normalizeText));
}
function isLikelyRaw(items, normalizedCommits) {
  if (!Array.isArray(items) || items.length === 0) return true;
  return items.every((item) => {
    const normalized = normalizeText(item);
    return normalizedCommits.has(normalized) || hasConventionalPrefix(item);
  });
}

async function callDeepSeek(commits) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const friendlyFallback = createFriendlyChanges(commits);

  if (!apiKey || apiKey === 'your-deepseek-api-key') {
    console.warn('  ⚠️  DEEPSEEK_API_KEY not set – using raw commit messages.');
    return friendlyFallback;
  }

  const numbered = commits.map((m, i) => `${i + 1}. ${m}`).join('\n');

  const systemPrompt =
    'You are a changelog writer. Transform git commit messages into friendly, ' +
    'non-technical release notes for end users. ' +
    'Group similar items when it makes sense. Maximum 6 bullet points per language. ' +
    'Return ONLY valid JSON – no markdown, no extra text.';

  const userPrompt =
    `Git commits from today:\n${numbered}\n\n` +
    'Produce a JSON object with two arrays:\n' +
    '{\n' +
    '  "es": ["punto 1 en español", "punto 2 en español"],\n' +
    '  "en": ["point 1 in English", "point 2 in English"]\n' +
    '}\n' +
    'Each item must be a complete, friendly sentence describing a user-facing improvement or fix.';

  const body = JSON.stringify({
    model: 'deepseek-v4-flash',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.5,
    max_tokens: 1200,
    response_format: { type: 'json_object' },
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.deepseek.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.message?.content ?? '';
          const match = content.match(/\{[\s\S]*\}/);
          if (match) {
            const result = JSON.parse(match[0]);
            if (Array.isArray(result.es) && Array.isArray(result.en)) {
              const normalizedCommits = buildNormalizedCommitSet(commits);
              if (isLikelyRaw(result.es, normalizedCommits) || isLikelyRaw(result.en, normalizedCommits)) {
                console.warn('  ⚠️  DeepSeek returned raw commits, using fallback.');
                return resolve(friendlyFallback);
              }
              return resolve(result);
            }
          }
          console.warn('  ⚠️  Unexpected DeepSeek response, using fallback.');
          resolve(friendlyFallback);
        } catch (e) {
          console.error('  ❌ DeepSeek parse error:', e.message);
          resolve(friendlyFallback);
        }
      });
    });

    req.on('error', (e) => {
      console.error('  ❌ DeepSeek request error:', e.message);
      resolve(friendlyFallback);
    });

    req.setTimeout(20000, () => {
      console.warn('  ⚠️  DeepSeek request timed out, using fallback.');
      req.destroy();
      resolve(friendlyFallback);
    });

    req.write(body);
    req.end();
  });
}

function getCommitsGroupedByDate(sinceDate) {
  const raw = execSync(
    `git log --since="${sinceDate} 00:00:00" --pretty=format:"===DATE===%ad===MSG===%B" --date=short --no-merges`,
    { encoding: 'utf8', cwd: ROOT }
  ).trim();

  if (!raw) return [];

  const commits = raw.split('===DATE===').filter(Boolean);
  const byDate = {};

  for (const block of commits) {
    const [dateLine, ...msgLines] = block.split('===MSG===');
    const date = dateLine.trim();
    const message = msgLines.join('===MSG===').trim();

    if (!date || !message) continue;

    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(message);
  }

  const sorted = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b));
  return sorted;
}

function bumpPatch(version) {
  const parts = version.split('.').map(Number);
  parts[2] = (parts[2] || 0) + 1;
  return parts.join('.');
}

async function main() {
  console.log('\n🔧 SionFlow – Changelog Fix Tool');
  console.log('═'.repeat(50));

  const changelog = readJSON(CHANGELOG_FILE);
  const lastEntry = changelog.entries[0];
  const lastDate = lastEntry ? lastEntry.date : '2025-01-01';
  let currentVersion = readJSON(VERSION_FILE).version;

  console.log(`\n📅 Last changelog entry: ${lastDate} (v${lastEntry?.version || '?'})`);
  console.log(`🔢 Current version: v${currentVersion}`);

  const commitsByDate = getCommitsGroupedByDate(lastDate);

  if (commitsByDate.length === 0) {
    console.log('\n✅ No missing commits found. Changelog is up to date.\n');
    return;
  }

  console.log(`\n📝 Found ${commitsByDate.length} day(s) with missing commits:\n`);

  for (const [date, msgs] of commitsByDate) {
    console.log(`  📆 ${date}: ${msgs.length} commit(s)`);
    msgs.forEach((m) => console.log(`     • ${extractSubject(m)}`));
  }

  console.log('\n🤖 Generating summaries...');

  const newEntries = [];

  for (const [date, msgs] of commitsByDate) {
    currentVersion = bumpPatch(currentVersion);
    console.log(`\n  🔢 ${date} → v${currentVersion} (${msgs.length} commits)`);

    const changes = await callDeepSeek(msgs);

    // Show generated bullets
    console.log('     ES:');
    changes.es.slice(0, 2).forEach((s) => console.log(`       - ${s}`));
    if (changes.es.length > 2) console.log(`       ... and ${changes.es.length - 2} more`);

    newEntries.push({ version: currentVersion, date, changes });
  }

  // Prepend new entries (newest first)
  changelog.entries = [...newEntries.reverse(), ...changelog.entries];
  changelog.current = currentVersion;

  writeJSON(CHANGELOG_FILE, changelog);
  console.log('\n✅ public/changelog.json updated.');

  const versionData = readJSON(VERSION_FILE);
  versionData.version = currentVersion;
  versionData.date = commitsByDate[commitsByDate.length - 1][0];
  writeJSON(VERSION_FILE, versionData);
  console.log('✅ public/version.json updated.');

  const pkg = readJSON(PACKAGE_FILE);
  pkg.version = currentVersion;
  writeJSON(PACKAGE_FILE, pkg);
  console.log('✅ package.json updated.');

  console.log(`\n✨ Done! App version is now v${currentVersion}\n`);
}

main().catch((err) => {
  console.error('[fix-changelog] Fatal error:', err);
  process.exit(1);
});
