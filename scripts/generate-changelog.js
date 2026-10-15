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

// Load env files before anything else (.env.local overrides .env)
require('dotenv').config({ path: path.join(ROOT, '.env') });
require('dotenv').config({ path: path.join(ROOT, '.env.local'), override: true });

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
 * Returns true when a commit is an internal/auto changelog commit
 * and should not appear in the user-facing changelog.
 */
function shouldSkipCommit(message) {
  const subject = extractSubject(message).toLowerCase();
  return (
    subject.includes('auto-update changelog') ||
    subject.includes('[skip changelog]') ||
    /^chore:\s*bump version/i.test(subject)
  );
}

/**
 * Returns the full messages (subject + body) of all commits from today (local time).
 * Merge commits and auto-changelog commits are excluded.
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
      .map((l) => l.trim())
      .filter(
        (l) =>
          l.length > 0 &&
          !l.startsWith('Merge ') &&
          !shouldSkipCommit(l)
      );
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

/** Category keys used in changelog.json (Keep a Changelog–style). */
const CHANGE_CATEGORIES = ['added', 'improved', 'fixed'];

function emptyLocalizedCategories() {
  return {
    es: { added: [], improved: [], fixed: [] },
    en: { added: [], improved: [], fixed: [] },
  };
}

/**
 * Guess category from a conventional commit subject.
 * feat → added, fix → fixed, everything else → improved.
 */
function guessCategoryFromCommit(message) {
  const subject = extractSubject(message).toLowerCase();
  if (/^\s*fix(\(|:|!)/i.test(subject) || /\bfix(es|ed)?\b/.test(subject)) {
    return 'fixed';
  }
  if (
    /^\s*feat(\(|:|!)/i.test(subject) ||
    /\b(add|adds|added|introduce|introduces)\b/.test(subject)
  ) {
    return 'added';
  }
  return 'improved';
}

function flattenLocalized(langBlock) {
  if (!langBlock) return [];
  if (Array.isArray(langBlock)) return langBlock;
  return CHANGE_CATEGORIES.flatMap((key) =>
    Array.isArray(langBlock[key]) ? langBlock[key] : []
  );
}

function isLikelyRaw(items, normalizedCommits) {
  if (!Array.isArray(items) || items.length === 0) return true;
  return items.every((item) => {
    const normalized = normalizeText(item);
    return normalizedCommits.has(normalized) || hasConventionalPrefix(item);
  });
}

/**
 * Normalize AI / fallback payload into:
 * { es: { added, improved, fixed }, en: { added, improved, fixed } }
 * Accepts legacy flat arrays under es/en for resilience.
 */
function normalizeCategorizedChanges(raw) {
  const out = emptyLocalizedCategories();
  if (!raw || typeof raw !== 'object') return out;

  for (const lang of ['es', 'en']) {
    const block = raw[lang];
    if (Array.isArray(block)) {
      // Legacy: put everything under improved
      out[lang].improved = block
        .map((s) => String(s).trim())
        .filter(Boolean)
        .slice(0, 6);
      continue;
    }
    if (!block || typeof block !== 'object') continue;

    for (const key of CHANGE_CATEGORIES) {
      const list = block[key];
      if (!Array.isArray(list)) continue;
      out[lang][key] = list
        .map((s) => String(s).trim())
        .filter(Boolean)
        .slice(0, 6);
    }
  }

  // Drop empty category keys for a cleaner JSON file
  for (const lang of ['es', 'en']) {
    for (const key of CHANGE_CATEGORIES) {
      if (!out[lang][key].length) delete out[lang][key];
    }
  }

  return out;
}

/**
 * Offline fallback when DeepSeek is unavailable.
 * Buckets by conventional commit type; quality is lower than the AI path.
 */
function createFriendlyChanges(commits) {
  const out = emptyLocalizedCategories();
  const limited = commits.slice(0, 6);

  for (const message of limited) {
    const category = guessCategoryFromCommit(message);
    const base = stripConventionalPrefix(extractSubject(message)) || 'internal changes';

    let esText = '';
    let enText = '';

    switch (category) {
      case 'added':
        esText = `Hemos añadido: ${translateToSpanish(base)}`;
        enText = `We added: ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
        break;
      case 'fixed':
        esText = `Hemos corregido: ${translateToSpanish(base)}`;
        enText = `We fixed: ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
        break;
      case 'improved':
      default:
        esText = `Hemos mejorado: ${translateToSpanish(base)}`;
        enText = `We improved: ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
        break;
    }

    out.es[category].push(ensureSentence(esText));
    out.en[category].push(ensureSentence(enText));
  }

  return normalizeCategorizedChanges(out);
}

function translateToSpanish(text) {
  const translations = {
    'add pwa offline image support and align notification scoping': 'soporte de imágenes offline en PWA y alineación del alcance de notificaciones',
    'add patriarchal blessing, lifecycle badges, and tooling': 'bendición patriarcal, insignias de ciclo de vida y herramientas',
    'add full interview scheduling, tracking and reminder system': 'sistema completo de programación, seguimiento y recordatorios de entrevistas',
    'bump dependencies and apply security patches': 'actualización de dependencias y parches de seguridad',
    'add min-w-0 to fix flex layout overflow': 'corrección de desbordamiento en diseño flexible con min-w-0',
    'add barrioorg scoping to firestore rules and update app code': 'alcance por barrioOrg en reglas de Firestore y actualización de código de la app',
    'fix firestore filtering and add max tokens env config': 'corrección de filtrado en Firestore y configuración de tokens máximos en variables de entorno',
    'rebrand to sionflow, add multi-tenant annotations & security settings': 'rebranding a SionFlow, anotaciones multi-tenant y ajustes de seguridad',
    'add install prompt and optimize pwa asset routes': 'indicador de instalación y optimización de rutas de assets PWA',
    'bump to v1.1.24 with pwa and tooling updates': 'actualización a v1.1.24 con mejoras en PWA y herramientas',
    'add user deletion and update related configs': 'eliminación de usuario y actualización de configuraciones relacionadas',
    'implement permission-based access control system': 'implementación de sistema de control de acceso basado en permisos',
    'add pwa icons, fix notification scoping': 'iconos PWA y corrección de alcance de notificaciones',
    'scope caches by barrioorg': 'cachés con alcance por barrioOrg',
    'add donation qr download': 'descarga de código QR para donaciones',
    'add member sync and notification improvements': 'sincronización de miembros y mejoras en notificaciones',
    'add barrio-org data scoping and donation support': 'alcance de datos por barrio-org y soporte para donaciones',
    'add president role, optimize audit logs, fix pwa manifest': 'rol de presidente, optimización de logs de auditoría y corrección de manifiesto PWA',
    'send notifs to same barrio org': 'envío de notificaciones al mismo barrioOrg',
    'implement white-labeling and data standardization': 'implementación de white-labeling y estandarización de datos',
    'initial commit: sionflow church management system': 'commit inicial: sistema de gestión de iglesia SionFlow',
    'update manifest.json': 'actualización de manifest.json',
    'use empty string for blank address and fix death date format': 'usar cadena vacía para dirección en blanco y corregir formato de fecha de defunción',
    'add member address support and display': 'soporte y visualización de dirección de miembro',
    'fix firestore filtering and add max tokens env config': 'corrección de filtrado en Firestore y configuración de tokens máximos en variables de entorno',
  };

  const lower = text.toLowerCase();
  for (const [en, es] of Object.entries(translations)) {
    if (lower.includes(en)) return es;
  }

  return text;
}

/** True if text looks like English (used to reject "Spanish" that is still English). */
function looksMostlyEnglish(text) {
  const sample = String(text || '').toLowerCase();
  if (!sample.trim()) return false;
  // Common English function words / commit-ish verbs
  const enHits = (
    sample.match(
      /\b(the|and|with|for|from|this|that|added|add|fix|fixed|update|updated|improve|improved|implement|implemented|refactor|feature|support|system|tracking|scheduling|reminder)\b/g
    ) || []
  ).length;
  const esHits = (
    sample.match(
      /\b(el|la|los|las|de|del|que|con|para|por|una|unos|unas|hemos|añadimos|mejoramos|ahora|puedes|puede|miembros|aplicación|cuenta|seguimiento|corregimos|agregamos)\b/g
    ) || []
  ).length;
  return enHits >= 2 && enHits > esHits;
}

/**
 * Rejects AI output that is still raw commits, bilingual-mixed, or too terse.
 * Accepts either categorized objects or legacy flat arrays.
 */
function isLowQualityChangelog(result, normalizedCommits) {
  if (!result || typeof result !== 'object') return true;

  const esItems = flattenLocalized(result.es);
  const enItems = flattenLocalized(result.en);
  if (esItems.length === 0 || enItems.length === 0) return true;

  if (isLikelyRaw(esItems, normalizedCommits) || isLikelyRaw(enItems, normalizedCommits)) {
    return true;
  }

  // Spanish side must actually read as Spanish
  if (esItems.some(looksMostlyEnglish)) return true;

  // Reject short codelike bullets / "Actualización: Foo bar" leftovers
  const badPrefix = /^(actualizaci[oó]n|update|fix|feat|chore)\s*:/i;
  for (const item of [...esItems, ...enItems]) {
    const t = String(item || '').trim();
    if (t.length < 40) return true; // too terse vs style of 1.1.36
    if (badPrefix.test(t)) return true;
    if (hasConventionalPrefix(t)) return true;
  }

  return false;
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

  const systemPrompt = [
    'You write end-user release notes for SionFlow, a ward/organization management app',
    'for The Church of Jesus Christ of Latter-day Saints (ministración, miembros, conversos, FamilySearch, etc.).',
    '',
    'GOAL: Help a non-technical leader see WHAT is new, WHAT was improved, and WHAT was fixed — and WHY it helps.',
    'Write like a warm product update, NOT like a git log.',
    '',
    'CATEGORIES (required — put each bullet in exactly one):',
    '- "added": brand-new capability the user did not have before (new screens, new fields, new workflows).',
    '- "improved": better behavior of something that already existed (faster, clearer, smarter, more offline, better UX).',
    '- "fixed": a bug or broken behavior that no longer happens.',
    'Omit a category entirely if it has no bullets. Never invent categories.',
    '',
    'STYLE (required):',
    '- First-person plural where natural: "Hemos…", "Añadimos…", "Ahora puedes…", "We\'ve…", "You can now…".',
    '- Full sentences (40–180 characters ideal). Explain the benefit, not just the feature name.',
    '- Spanish bullets must be real Spanish (never leave English commit text under "es").',
    '- English bullets must be real English.',
    '- Group related commits into one richer bullet when they are the same user story.',
    '- Skip pure internal work (tests, refactors, CI, dependency bumps) unless it clearly helps users.',
    '- Max 6 bullets total per language across all categories. Prefer 2–4 clear bullets.',
    '- Do NOT use prefixes like "Actualización:", "Update:", "feat:", "fix:".',
    '- Do NOT copy commit subjects verbatim. Rewrite in plain language.',
    '- Avoid jargon: no "API", "JSON", "Firestore", "hook", "PR", "refactor" unless necessary.',
    '',
    'GOOD examples:',
    'added ES: "Ahora puedes programar entrevistas de ministración con fecha, hora y quién del compañerismo asistirá."',
    'improved ES: "Hemos mejorado la velocidad de subida al comprimir las fotos de perfil (máx. 640px y 180KB)."',
    'fixed ES: "Corregimos un fallo al iniciar sesión que a veces dejaba la sesión a medias y obligaba a reintentar."',
    '',
    'BAD examples (never do this):',
    '- Flat arrays without categories',
    '- "Actualización: Add full interview scheduling…"',
    '- "feat(ministering): add interviews"',
    '',
    'Return ONLY valid JSON – no markdown fences, no commentary.',
  ].join('\n');

  const userPrompt = [
    'Git commits from today (rewrite into user-facing notes; do not echo them raw):',
    numbered,
    '',
    'Produce JSON exactly in this shape (omit empty category arrays):',
    '{',
    '  "es": {',
    '    "added": ["frase completa en español…"],',
    '    "improved": ["…"],',
    '    "fixed": ["…"]',
    '  },',
    '  "en": {',
    '    "added": ["complete sentence in English…"],',
    '    "improved": ["…"],',
    '    "fixed": ["…"]',
    '  }',
    '}',
    'es and en must cover the same changes (same categories, same count per category).',
    'Focus on what leaders and members can do now that they could not before.',
  ].join('\n');

  const body = JSON.stringify({
    model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   },
    ],
    // Slightly higher temp for natural prose; still constrained by the style guide.
    temperature: 0.65,
    max_tokens: 1600,
    response_format: { type: 'json_object' },
    thinking: { type: 'disabled' },
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
          if (json.error) {
            console.error('[changelog] DeepSeek API error:', json.error.message || JSON.stringify(json.error));
            return resolve(friendlyFallback);
          }
          const content = json.choices?.[0]?.message?.content ?? '';
          const match   = content.match(/\{[\s\S]*\}/);
          if (match) {
            const result = JSON.parse(match[0]);
            const hasEs = result.es && (Array.isArray(result.es) || typeof result.es === 'object');
            const hasEn = result.en && (Array.isArray(result.en) || typeof result.en === 'object');
            if (hasEs && hasEn) {
              const normalizedCommits = buildNormalizedCommitSet(commits);
              if (isLowQualityChangelog(result, normalizedCommits)) {
                console.warn(
                  '[changelog] DeepSeek output failed quality checks (raw/too short/not Spanish). Using fallback.'
                );
                console.warn('[changelog] Rejected es:', JSON.stringify(result.es));
                console.warn('[changelog] Rejected en:', JSON.stringify(result.en));
                return resolve(friendlyFallback);
              }
              return resolve(normalizeCategorizedChanges(result));
            }
          }
          console.warn('[changelog] Unexpected DeepSeek response, using friendly fallback.');
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
  console.log('\n📋 SionFlow – Changelog Generator');
  console.log('─'.repeat(40));

  const commits = getCommitsForToday();
  if (commits.length === 0) {
    console.log('ℹ️  No commits found for today. Nothing to do.\n');
    return;
  }

  console.log(`📝 ${commits.length} commit(s) found:`);
  commits.forEach((c) => console.log(`   • ${extractSubject(c)}`));

  // ── Load current data ──────────────────────────────────────────────────
  let changelog = { current: '1.0.0', entries: [] };
  if (fs.existsSync(CHANGELOG_FILE)) {
    try { changelog = readJSON(CHANGELOG_FILE); }
    catch { console.warn('[changelog] Could not parse changelog.json – starting fresh.'); }
  }

  if (!fs.existsSync(VERSION_FILE)) {
    console.error('[changelog] public/version.json not found.');
    process.exit(1);
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
    // Prefer the entry's version if today already exists; keep package in sync
    newVersion = changelog.entries[todayIndex]?.version || versionData.version;
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
  CHANGE_CATEGORIES,
  normalizeText,
  extractSubject,
  stripConventionalPrefix,
  ensureSentence,
  buildNormalizedCommitSet,
  isLikelyRaw,
  looksMostlyEnglish,
  isLowQualityChangelog,
  createFriendlyChanges,
  normalizeCategorizedChanges,
  guessCategoryFromCommit,
  flattenLocalized,
  shouldSkipCommit,
};
