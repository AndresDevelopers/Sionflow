#!/usr/bin/env node
/**
 * Generates changelog from today's git commits using DeepSeek AI.
 *
 * Behavior:
 *   - Collects all commits made today (grouped by date)
 *   - Calls DeepSeek to produce user-friendly text in ES + EN
 *   - Bumps the patch version only on the first commit of a new day
 *   - Updates: public/changelog.json, public/version.json, package.json
 *
 * Run manually:  node scripts/generate-changelog.js
 * Auto-run via: git post-commit hook (see scripts/setup-hooks.js)
 */

const path = require('path');
const ROOT = path.join(__dirname, '..');

// Load .env before anything else
require('dotenv').config({ path: path.join(ROOT, '.env') });

const { execSync } = require('child_process');
const fs = require('fs');
const https = require('https');

const CHANGELOG_FILE = path.join(ROOT, 'public', 'changelog.json');
const VERSION_FILE   = path.join(ROOT, 'public', 'version.json');
const PACKAGE_FILE   = path.join(ROOT, 'package.json');

// ─── Helpers ────────────────────────────────────────────────────────────────

function getLocalDateISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns the full messages (subject + body) of all commits from today (local time).
 * Merge commits are excluded.
 */
function getCommitsForToday() {
  const today = getLocalDateISO();
  try {
    const raw = execSync(
      `git log --since="${today} 00:00:00" --pretty=format:"===COMMIT===%n%B" --no-merges`,
      { encoding: 'utf8', cwd: ROOT }
    ).trim();

    if (!raw) return [];
    return raw
      .split('===COMMIT===')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('Merge '));
  } catch (err) {
    console.error('[changelog] Could not read git log:', err.message);
    return [];
  }
}

function bumpPatch(version) {
  const parts = version.split('.').map(Number);
  parts[2] = (parts[2] || 0) + 1;
  return parts.join('.');
}

function normalizeText(value) {
  return value.toLowerCase().replace(/[\s\W_]+/g, '');
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

function buildNormalizedCommitSet(commits) {
  const subjects = commits.map(extractSubject);
  const cleaned = subjects.map(stripConventionalPrefix);
  const combined = [...commits, ...subjects, ...cleaned].filter(Boolean);
  return new Set(combined.map(normalizeText));
}

function hasConventionalPrefix(text) {
  return /^\s*(feat|fix|chore|docs|refactor|perf|test|build|ci|style|revert)(\([^)]+\))?(!)?\s*:\s*/i.test(text);
}

function isLikelyRaw(items, normalizedCommits) {
  if (!Array.isArray(items) || items.length === 0) return true;
  return items.every((item) => {
    const normalized = normalizeText(item);
    return normalizedCommits.has(normalized) || hasConventionalPrefix(item);
  });
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

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ─── DeepSeek AI ────────────────────────────────────────────────────────────

/**
 * Calls DeepSeek chat API.
 * Falls back to raw commit messages when the key is missing or the call fails.
 */
async function callDeepSeek(commits) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const friendlyFallback = createFriendlyChanges(commits);

  if (!apiKey || apiKey === 'your-deepseek-api-key') {
    console.warn('[changelog] DEEPSEEK_API_KEY not set – using raw commit messages.');
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
      { role: 'user',   content: userPrompt   },
    ],
    temperature: 0.5,
    max_tokens: 1200,
    response_format: { type: 'json_object' },
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.deepseek.com',
      path:     '/v1/chat/completions',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Authorization':  `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json    = JSON.parse(data);
          const content = json.choices?.[0]?.message?.content ?? '';
          const match   = content.match(/\{[\s\S]*\}/);
          if (match) {
            const result = JSON.parse(match[0]);
            if (Array.isArray(result.es) && Array.isArray(result.en)) {
              const normalizedCommits = buildNormalizedCommitSet(commits);
              if (isLikelyRaw(result.es, normalizedCommits) || isLikelyRaw(result.en, normalizedCommits)) {
                console.warn('[changelog] DeepSeek returned raw commits, using friendly fallback.');
                return resolve(friendlyFallback);
              }
              return resolve(result);
            }
          }
          console.warn('[changelog] Unexpected DeepSeek response, using raw commits.');
          resolve(friendlyFallback);
        } catch (e) {
          console.error('[changelog] DeepSeek parse error:', e.message);
          resolve(friendlyFallback);
        }
      });
    });

    req.on('error', (e) => {
      console.error('[changelog] DeepSeek request error:', e.message);
      resolve(friendlyFallback);
    });

    req.setTimeout(20000, () => {
      console.warn('[changelog] DeepSeek request timed out, using raw commits.');
      req.destroy();
      resolve(friendlyFallback);
    });

    req.write(body);
    req.end();
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n📋 QuorumFlow – Changelog Generator');
  console.log('─'.repeat(40));

  const commits = getCommitsForToday();
  if (commits.length === 0) {
    console.log('ℹ️  No commits found for today. Nothing to do.\n');
    return;
  }

  console.log(`📝 ${commits.length} commit(s) found:`);
  commits.forEach((c) => console.log(`   • ${c}`));

  // ── Load current data ──────────────────────────────────────────────────
  let changelog = { current: '1.0.0', entries: [] };
  if (fs.existsSync(CHANGELOG_FILE)) {
    try { changelog = readJSON(CHANGELOG_FILE); }
    catch { console.warn('[changelog] Could not parse changelog.json – starting fresh.'); }
  }

  const versionData = readJSON(VERSION_FILE);
  const today       = getLocalDateISO();

  // ── Version bumping ────────────────────────────────────────────────────
  const todayIndex = changelog.entries.findIndex((e) => e.date === today);
  const isNewDay   = todayIndex === -1;

  let newVersion = versionData.version;
  if (isNewDay) {
    newVersion = bumpPatch(versionData.version);
    console.log(`\n🔢 New day – bumping version: ${versionData.version} → ${newVersion}`);
  } else {
    console.log(`\n🔄 Updating today's existing entry for v${newVersion}`);
  }

  // ── AI summary ─────────────────────────────────────────────────────────
  console.log('\n🤖 Calling DeepSeek AI…');
  const changes = await callDeepSeek(commits);
  console.log('✅ AI summary ready.');

  // ── Update changelog ───────────────────────────────────────────────────
  const newEntry = { version: newVersion, date: today, changes };

  if (isNewDay) {
    changelog.entries.unshift(newEntry);
  } else {
    changelog.entries[todayIndex] = newEntry;
  }
  changelog.current = newVersion;

  writeJSON(CHANGELOG_FILE, changelog);
  console.log('✅ public/changelog.json updated.');

  // ── Update version.json ────────────────────────────────────────────────
  versionData.version = newVersion;
  versionData.date    = today;
  writeJSON(VERSION_FILE, versionData);
  console.log('✅ public/version.json updated.');

  // ── Update package.json ────────────────────────────────────────────────
  const pkg = readJSON(PACKAGE_FILE);
  pkg.version = newVersion;
  writeJSON(PACKAGE_FILE, pkg);
  console.log('✅ package.json updated.');

  console.log(`\n✨ Done! App version is now v${newVersion}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[changelog] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = {
  normalizeText,
  extractSubject,
  stripConventionalPrefix,
  ensureSentence,
  buildNormalizedCommitSet,
  isLikelyRaw,
  createFriendlyChanges,
};
