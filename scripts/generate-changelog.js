#!/usr/bin/env node
/**
 * Generates a user-facing changelog from today's git commits using DeepSeek AI.
 *
 * Rules:
 *   - Only user-visible work is published: no dependencies, configs, tests, CI,
 *     scripts, refactors or internal maintenance tooling.
 *   - Spanish bullets contain only Spanish; English bullets contain only English.
 *   - "added" = something the user could not do before (checked against the files
 *     each commit touches), "improved" = an existing feature behaves better,
 *     "fixed" = a bug users experienced no longer happens.
 *   - When the AI is unavailable the local fallback still respects language and audience.
 *
 * How to tell a new feature apart (evidence sent to the AI): each commit is sent with
 * its changed files. New pages/routes/components mean a new capability; edits to
 * existing screens mean an improvement unless the commit introduces new behavior.
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

const MAX_BULLETS_PER_LANGUAGE = 8;
const MIN_BULLET_LENGTH = 25;

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
    subject.includes('[skip ci]') ||
    /^chore:\s*bump version/i.test(subject)
  );
}

/** Files that never change what a normal user sees. */
const INTERNAL_PATH_PATTERNS = [
  /^scripts\//,
  /^docs?\//,
  /^\.github\//,
  /^public\/(changelog|version)\.json$/,
  /(^|\/)__tests__\//,
  /(^|\/)__mocks__\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /^package(-lock)?\.json$/,
  /^pnpm-lock\.yaml$/,
  /^pnpm-workspace\.yaml$/,
  /^yarn\.lock$/,
  /^(tsconfig[^/]*\.json|next-env\.d\.ts|global\.d\.ts)$/,
  /^(eslint\.config\.[^/]+|next\.config\.[^/]+|tailwind\.config\.[^/]+)$/,
  /^(postcss\.config\.[^/]+|vitest\.config\.[^/]+|components\.json)$/,
  /^(firebase\.json|firestore\.rules|firestore\.indexes\.json|storage\.rules)$/,
  /^(cors[^/]*\.json|vercel\.json|sonar-project\.properties|\.gitignore|\.npmrc)$/,
  /\.md$/,
  /^\.env/,
  /^instrumentation(-client)?\.ts$/,
  /^functions\/lib\//,
];

/** Subjects that describe developer work, even when code files changed. */
const INTERNAL_SUBJECT_PATTERNS = [
  /\[skip changelog\]/i,
  /\bauto-update changelog\b/i,
  /\bchangelog (entry|generator|script)\b/i,
  /^merge (pull request|branch|remote)\b/i,
  /\bdependabot\b/i,
  /\bbump\b.*\b(version|dependenc|deps|packages?)\b/i,
  /\b(update|upgrade|bump)\b.*\b(dependenc|deps|packages|lockfile|node version)\b/i,
  /\b(eslint|prettier|husky|lint-staged|tsconfig|gitignore|readme|sonar|webpack config)\b/i,
  /\b(deepseek|openai) (model|api)\b/i,
  /\bgithub actions?\b/i,
  /^chore(\(|:|!)/i,
  /^docs?(\(|:|!)/i,
  /^tests?(\(|:|!)/i,
  /^ci(\(|:|!)/i,
  /^build(\(|:|!)/i,
  /^style(\(|:|!)/i,
  /^refactor(\(|:|!)/i,
  /^revert(\(|:|!)/i,
];

function isInternalPath(filePath) {
  return INTERNAL_PATH_PATTERNS.some((re) => re.test(filePath));
}

function normalizeCommit(commit) {
  if (typeof commit === 'string') return { message: commit, files: [] };
  if (!commit || typeof commit !== 'object') return { message: '', files: [] };
  return { message: commit.message || '', files: Array.isArray(commit.files) ? commit.files : [] };
}

/**
 * True when the commit can change something a normal user experiences.
 * Conventional types such as chore/docs/test/ci/refactor are dropped, as is any
 * commit that only touches tooling, configs, tests or generated files.
 */
function isUserFacingCommit(commit) {
  const { message, files } = normalizeCommit(commit);
  const subject = extractSubject(message);
  if (!subject || shouldSkipCommit(message)) return false;
  if (INTERNAL_SUBJECT_PATTERNS.some((re) => re.test(subject))) return false;
  if (files.length === 0) return true;
  return files.some((file) => !isInternalPath(typeof file === 'string' ? file : file.path || ''));
}

/** Parses `git log --name-status --pretty=format:"===COMMIT===%n%B%n===FILES==="`. */
function parseGitLog(raw) {
  const chunks = String(raw || '').split('===COMMIT===').slice(1);
  const commits = [];

  for (const chunk of chunks) {
    const marker = chunk.indexOf('===FILES===');
    const messagePart = marker === -1 ? chunk : chunk.slice(0, marker);
    const filePart = marker === -1 ? '' : chunk.slice(marker + '===FILES==='.length);
    const message = messagePart.trim();
    if (!message) continue;

    const files = filePart
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+/);
        if (parts.length < 2) return null;
        const status = parts[0].charAt(0).toUpperCase();
        // Renames/copies list "old new": the interesting path is the last one.
        return { status, path: parts[parts.length - 1] };
      })
      .filter(Boolean);

    commits.push({ message, files });
  }

  return commits;
}

/**
 * Returns every commit from today (local time) with the files it touched.
 * Merge commits and auto-changelog commits are excluded.
 */
function getCommitsForToday() {
  const today = getLocalDateISO();
  try {
    const raw = execSync(
      `git log --since="${today} 00:00:00" --no-merges --name-status --pretty=format:"===COMMIT===%n%B%n===FILES==="`,
      { encoding: 'utf8', cwd: ROOT, maxBuffer: 10 * 1024 * 1024 }
    );

    return parseGitLog(raw).filter(
      (commit) =>
        !extractSubject(commit.message).startsWith('Merge ') &&
        !shouldSkipCommit(commit.message)
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
  return String(message || '').split('\n')[0].trim();
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
  const messages = commits.map((c) => normalizeCommit(c).message);
  const subjects = messages.map(extractSubject);
  const cleaned = subjects.map(stripConventionalPrefix);
  const combined = [...messages, ...subjects, ...cleaned].filter(Boolean);
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
    /\b(add|adds|added|introduce|introduces|new)\b/.test(subject)
  ) {
    return 'added';
  }
  return 'improved';
}

/** Spanish / English labels for the app areas, used by the offline fallback. */
const MODULE_LABELS = {
  members: { es: 'Miembros', en: 'Members' },
  converts: { es: 'Conversos', en: 'Converts' },
  observations: { es: 'Observaciones', en: 'Observations' },
  ministering: { es: 'Ministración', en: 'Ministering' },
  council: { es: 'Consejo', en: 'Council' },
  'missionary-work': { es: 'Obra Misional', en: 'Missionary Work' },
  birthdays: { es: 'Cumpleaños', en: 'Birthdays' },
  service: { es: 'Servicio', en: 'Service' },
  settings: { es: 'Ajustes', en: 'Settings' },
  reports: { es: 'Reportes', en: 'Reports' },
  dashboard: { es: 'Tablero', en: 'Dashboard' },
  notifications: { es: 'Notificaciones', en: 'Notifications' },
  'family-search': { es: 'FamilySearch', en: 'FamilySearch' },
  activities: { es: 'Actividades', en: 'Activities' },
  interviews: { es: 'Entrevistas', en: 'Interviews' },
  newsletter: { es: 'Boletín informativo', en: 'Newsletter' },
  donations: { es: 'Donaciones', en: 'Donations' },
  agenda: { es: 'Agenda', en: 'Agenda' },
  temple: { es: 'Templo', en: 'Temple' },
  chat: { es: 'Chat de la Iglesia', en: 'Church Chat' },
  auth: { es: 'Inicio de sesión', en: 'Sign-in' },
  login: { es: 'Inicio de sesión', en: 'Sign-in' },
};

/** Returns up to two app areas touched by the commit's files. */
function detectModules(files) {
  const found = [];
  for (const file of files || []) {
    const filePath = typeof file === 'string' ? file : file.path || '';
    for (const segment of filePath.toLowerCase().split('/')) {
      if (MODULE_LABELS[segment] && !found.includes(segment)) found.push(segment);
    }
  }
  return found.slice(0, 2);
}

/** Strips file names and code-ish tails from a commit subject for the fallback. */
function humanizeCommitSubject(message) {
  return stripConventionalPrefix(extractSubject(message))
    .replace(/\s+in\s+[\w./@-]+\.(tsx?|jsx?|mjs|cjs|json)\b.*$/i, '')
    .replace(/\s*\([^)]*\.(tsx?|jsx?|mjs|cjs|json)\)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
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
      // Legacy: keep everything under improved
      out[lang].improved = block
        .map((s) => String(s).trim())
        .filter(Boolean)
        .slice(0, MAX_BULLETS_PER_LANGUAGE);
      continue;
    }
    if (!block || typeof block !== 'object') continue;

    let budget = MAX_BULLETS_PER_LANGUAGE;
    for (const key of CHANGE_CATEGORIES) {
      const list = block[key];
      if (!Array.isArray(list) || budget <= 0) continue;
      const cleaned = list.map((s) => String(s).trim()).filter(Boolean).slice(0, budget);
      out[lang][key] = cleaned;
      budget -= cleaned.length;
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
 * Never mixes languages: known subjects use curated Spanish translations, everything
 * else is described in Spanish from the app area the commit touched.
 */
function createFriendlyChanges(commits) {
  const out = emptyLocalizedCategories();
  const userFacing = (commits || [])
    .map(normalizeCommit)
    .filter(isUserFacingCommit)
    .slice(0, MAX_BULLETS_PER_LANGUAGE);

  const seen = { es: new Set(), en: new Set() };

  for (const commit of userFacing) {
    const category = guessCategoryFromCommit(commit.message);
    const base = humanizeCommitSubject(commit.message);
    const modules = detectModules(commit.files);

    const esDetail = translateToSpanish(base);
    const enDetail = looksMostlySpanish(base)
      ? null
      : stripLeadingVerb(base, category);

    const areaEs = modules.length
      ? `la sección de ${MODULE_LABELS[modules[0]].es}`
      : 'la aplicación';
    const areaEn = modules.length
      ? `the ${MODULE_LABELS[modules[0]].en} section`
      : 'the app';

    const esText = esDetail
      ? ensureSentence(`${FALLBACK_VERB[category].es} ${esDetail}`)
      : ensureSentence(
          category === 'added'
            ? `Hemos añadido una nueva función en ${areaEs}`
            : category === 'fixed'
              ? `Hemos corregido un problema en ${areaEs}`
              : `Hemos mejorado ${areaEs}`
        );

    const enText = enDetail
      ? ensureSentence(`${FALLBACK_VERB[category].en} ${decapitalize(enDetail)}`)
      : ensureSentence(
          category === 'added'
            ? `We added a new feature in ${areaEn}`
            : category === 'fixed'
              ? `We fixed a problem in ${areaEn}`
              : `We improved ${areaEn}`
        );

    if (!seen.es.has(esText)) {
      seen.es.add(esText);
      out.es[category].push(esText);
    }
    if (!seen.en.has(enText)) {
      seen.en.add(enText);
      out.en[category].push(enText);
    }
  }

  return normalizeCategorizedChanges(out);
}

const FALLBACK_VERB = {
  added: { es: 'Hemos añadido', en: 'We added' },
  improved: { es: 'Hemos mejorado', en: 'We improved' },
  fixed: { es: 'Hemos corregido', en: 'We fixed' },
};

/** Avoids duplicated verbs like "We added add …" when reusing a commit subject. */
function stripLeadingVerb(text, category) {
  const verbs = {
    added: /^(add|adds|added|introduce|introduces|create|creates)\s+/i,
    fixed: /^(fix|fixes|fixed|repair|repairs|repaired|resolve|resolves|resolved)\s+/i,
    improved:
      /^(improve|improves|improved|update|updates|updated|enhance|enhances|enhanced|optimize|optimizes|optimized)\s+/i,
  };
  return String(text || '').replace(verbs[category] || /^$/, '').trim();
}

function decapitalize(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  // Keep acronyms and proper nouns intact ("PWA", "FamilySearch").
  if (/^[A-ZÁÉÍÓÚÑ]{2,}/.test(trimmed)) return trimmed;
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

/** Curated Spanish phrasing for recurring commit subjects. Returns null if unknown. */
function translateToSpanish(text) {
  const translations = {
    'add pwa offline image support and align notification scoping': 'soporte de imágenes sin conexión en la PWA y mejor alineación de las notificaciones',
    'add patriarchal blessing, lifecycle badges, and tooling': 'la bendición patriarcal, las insignias de ciclo de vida y nuevas herramientas',
    'add full interview scheduling, tracking and reminder system': 'un sistema completo de programación, seguimiento y recordatorios de entrevistas',
    'add temple recommend tracking and expiry notifications': 'el seguimiento de las recomendaciones para el templo y los avisos de vencimiento',
    'bump dependencies and apply security patches': 'la actualización de dependencias y los parches de seguridad',
    'add min-w-0 to fix flex layout overflow': 'la corrección de un desbordamiento en el diseño de la interfaz',
    'add barrioorg scoping to firestore rules and update app code': 'un mejor aislamiento de los datos entre barrios',
    'fix firestore filtering and add max tokens env config': 'la corrección de filtros de datos y la configuración de respuestas de la IA',
    'rebrand to sionflow, add multi-tenant annotations & security settings': 'la nueva imagen de SionFlow, las anotaciones por organización y los ajustes de seguridad',
    'add install prompt and optimize pwa asset routes': 'el aviso para instalar la aplicación y una carga más rápida de sus archivos',
    'bump to v1.1.24 with pwa and tooling updates': 'novedades de la aplicación instalable y mejoras internas',
    'add user deletion and update related configs': 'la posibilidad de eliminar usuarios',
    'implement permission-based access control system': 'un sistema de permisos por rol',
    'add pwa icons, fix notification scoping': 'los iconos de la aplicación instalable y la correcta entrega de notificaciones',
    'scope caches by barrioorg': 'los datos guardados por barrio',
    'add donation qr download': 'la descarga del código QR para donaciones',
    'add member sync and notification improvements': 'la sincronización de miembros y mejoras en las notificaciones',
    'add barrio-org data scoping and donation support': 'el aislamiento de datos por barrio y el soporte para donaciones',
    'add president role, optimize audit logs, fix pwa manifest': 'el rol de presidente y la corrección de la instalación de la aplicación',
    'send notifs to same barrio org': 'el envío de notificaciones al mismo barrio',
    'implement white-labeling and data standardization': 'la personalización de la aplicación y la estandarización de datos',
    'initial commit: sionflow church management system': 'la primera versión del sistema de gestión de barrio',
    'use empty string for blank address and fix death date format': 'la corrección de direcciones vacías y del formato de fecha de defunción',
    'add member address support and display': 'el registro y la visualización de la dirección de los miembros',
    'add member picker for health concerns': 'la selección de miembros al registrar necesidades de salud',
    'add pagination, infinite scroll, and locale updates': 'la paginación y la carga automática de listas más largas',
    'add newsletter subscription system and admin tools': 'un sistema de suscripción al boletín informativo',
    'add temple work tracking for deceased members': 'el seguimiento del trabajo del templo para miembros fallecidos',
    'add interview scheduling': 'la programación de entrevistas',
  };

  const lower = String(text || '').toLowerCase().replace(/[.!?]+$/, '').trim();
  if (!lower) return null;
  for (const [en, es] of Object.entries(translations)) {
    if (lower === en || lower.includes(en)) return es;
  }
  return null;
}

const EN_WORD_RE = /\b(the|and|with|for|from|this|that|added|add|fix|fixed|update|updated|improve|improved|implement|implemented|refactor|feature|support|system|tracking|scheduling|reminder|members?|page|screen|section|field|list|users?|now|you|can|which|was|were|has|have|not|new|also|all|temple|notification|notifications|button|data)\b/g;
const ES_WORD_RE = /\b(el|la|los|las|de|del|que|con|para|por|una|uno|un|ahora|puedes|pueden|podrás|hemos|añadimos|agregamos|mejoramos|corregimos|miembros|miembro|sección|página|pantalla|aplicación|desde|cuando|también|sin|más|tus|sus|esta|este|nueva|nuevo|nuevas|nuevos|lista|datos|solo|sólo|ver|fácil|equivocaciones)\b/g;

function countMatches(text, re) {
  return (String(text || '').toLowerCase().match(re) || []).length;
}

/** True if text looks like English (used to reject "Spanish" that is still English). */
function looksMostlyEnglish(text) {
  const sample = String(text || '').toLowerCase();
  if (!sample.trim()) return false;
  const enHits = countMatches(sample, EN_WORD_RE);
  const esHits = countMatches(sample, ES_WORD_RE);
  return enHits >= 2 && enHits > esHits;
}

/** True if text looks like Spanish (used to keep English bullets English-only). */
function looksMostlySpanish(text) {
  const sample = String(text || '').toLowerCase();
  if (!sample.trim()) return false;
  const accents = (sample.match(/[áéíóúñ¿¡]/g) || []).length;
  const esHits = countMatches(sample, ES_WORD_RE);
  const enHits = countMatches(sample, EN_WORD_RE);
  if (accents > 0 && enHits < 2) return true;
  return esHits >= 2 && esHits > enHits;
}

const BAD_PREFIX_RE = /^(actualizaci[oó]n|novedades?|update|updates|fix|fixes|feat|chore|improved|improvement)\s*:/i;
const MIXED_LANGUAGE_RE = /\b(actualizaci[oó]n|hemos (añadido|mejorado|corregido)|añadimos|agregamos|mejoramos|corregimos)\s*:\s*(add|adds|added|fix|fixes|fixed|update|updated|improve|improved|implement|implemented|remove|removed|refactor|support|bump|use|allow|enable)\b/i;
const FILE_PATH_RE = /\b[\w.-]+\/[\w./@-]+\.(tsx?|jsx?|json|mjs|cjs|css)\b/i;
const TECH_JARGON_RE = /\b(API|JSON|Firestore|Firebase|endpoint|hook|refactor|tsx|eslint|webpack|PR)\b/;

/**
 * Rejects AI output that is still raw commits, bilingual-mixed, in the wrong language,
 * only about developer work, or too terse.
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

  // Both languages must describe the same set of changes.
  if (result.es && result.en && !Array.isArray(result.es) && !Array.isArray(result.en)) {
    for (const key of CHANGE_CATEGORIES) {
      const esCount = Array.isArray(result.es[key]) ? result.es[key].length : 0;
      const enCount = Array.isArray(result.en[key]) ? result.en[key].length : 0;
      if (esCount !== enCount) return true;
    }
  }

  // Language purity.
  if (esItems.some((item) => looksMostlyEnglish(item))) return true;
  if (enItems.some((item) => looksMostlySpanish(item))) return true;

  for (const item of [...esItems, ...enItems]) {
    const text = String(item || '').trim();
    if (text.length < MIN_BULLET_LENGTH) return true;
    if (BAD_PREFIX_RE.test(text) || hasConventionalPrefix(text)) return true;
    if (MIXED_LANGUAGE_RE.test(text)) return true;
    if (FILE_PATH_RE.test(text) || TECH_JARGON_RE.test(text)) return true;
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

/** Commit + context (details and touched files) for the model. */
function formatCommitsForPrompt(commits) {
  return commits
    .slice(0, 25)
    .map((commit, index) => {
      const { message, files } = normalizeCommit(commit);
      const subject = extractSubject(message);
      const body = message.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      const fileList = files.map((f) => (typeof f === 'string' ? f : f.path)).filter(Boolean).slice(0, 12);
      return [
        `${index + 1}. ${subject}`,
        body ? `   More detail: ${body}` : '',
        fileList.length ? `   Files touched: ${fileList.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');
}

/**
 * Calls DeepSeek chat API.
 * Falls back to the local summary when the key is missing or the call fails.
 */
async function callDeepSeek(commits) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const friendlyFallback = createFriendlyChanges(commits);

  if (!apiKey || apiKey === 'your-deepseek-api-key') {
    console.warn('[changelog] DEEPSEEK_API_KEY not set – using local summary.');
    return friendlyFallback;
  }

  const systemPrompt = [
    'You write release notes for SionFlow, an app that Latter-day Saint ward leaders and members',
    'use for miembros, conversos, ministración, FamilySearch, entrevistas, notificaciones, etc.',
    'The readers are normal users, not developers.',
    '',
    'WHAT THEY CARE ABOUT',
    '- A problem they had is gone ("fixed").',
    '- Something new they can do now ("added").',
    '- A feature they already use got better ("improved").',
    'Nothing else. No code updates, no dependencies, no configs, no tests, no CI, no scripts,',
    'no refactors, no internal maintenance or admin tooling. Never mention who programmed it.',
    '',
    'HOW TO CLASSIFY (use the "Files touched" evidence and compare to what already existed)',
    '- "added": a capability the user did not have before. Signals: a brand-new page, screen,',
    '  dialog, route, form section, field or workflow, or wording that introduces something new.',
    '- "improved": an existing screen or feature that now works faster, clearer, smarter or more',
    '  reliably. Editing existing user-facing files is an improvement unless the user gains a new',
    '  action they could not do before.',
    '- "fixed": a bug users could experience no longer happens.',
    '- A fix that also adds code is still "fixed". Do not call a bug fix a new feature.',
    '- Omit a category entirely when it has no bullets. Never invent changes.',
    '',
    'STYLE (required)',
    '- Spanish bullets: Spanish only, every word. English bullets: English only, every word.',
    '  Never mix languages inside a bullet. Translate screen names; leave no English in "es".',
    '- Full sentences (40-180 characters). Say what the user can now do and where they find it.',
    '- Same meaning, same categories and same number of bullets in both languages.',
    '- Cover every user-facing change: each commit must be reflected in at least one bullet.',
    '  Do not merge unrelated changes into one vague sentence.',
    '- Max 8 bullets per language.',
    '- No prefixes like "Actualización:" or "Update:", no copied commit subjects, no file names,',
    '  no jargon (API, JSON, Firestore, hook, endpoint, refactor, tsx), no version numbers.',
    '',
    'GOOD examples:',
    'added ES: "Ahora puedes programar entrevistas de ministración con fecha, hora y quién del compañerismo asistirá."',
    'added EN: "You can now schedule ministering interviews with a date, time, and who from the companionship will attend."',
    'improved ES: "Hemos mejorado la velocidad de subida al comprimir las fotos de perfil (máx. 640px y 180KB)."',
    'fixed ES: "Corregimos un fallo al iniciar sesión que a veces dejaba la sesión a medias y obligaba a reintentar."',
    '',
    'BAD examples (never do this):',
    '- "Hemos añadido: add temple recommend tracking and expiry notifications." (mixed language)',
    '- "We added temple recommend tracking..." (English inside the Spanish field)',
    '- "Actualización: bump dependencies and update ESLint config" (developer work)',
    '- "feat(ministering): add interviews" (raw commit)',
    '',
    'Return ONLY valid JSON - no markdown fences, no commentary.',
  ].join('\n');

  const userPrompt = [
    'Today\'s git commits with the files they touched:',
    formatCommitsForPrompt(commits),
    '',
    'Rewrite them as user-facing release notes. Use the files to decide whether something is a',
    'brand-new capability ("added") or a better existing feature ("improved").',
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
  ].join('\n');

  const body = JSON.stringify({
    model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   },
    ],
    temperature: 0.4,
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
                  '[changelog] DeepSeek output failed quality checks (raw/mixed language/too short/technical). Using local summary.'
                );
                console.warn('[changelog] Rejected es:', JSON.stringify(result.es));
                console.warn('[changelog] Rejected en:', JSON.stringify(result.en));
                return resolve(friendlyFallback);
              }
              return resolve(normalizeCategorizedChanges(result));
            }
          }
          console.warn('[changelog] Unexpected DeepSeek response, using local summary.');
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
      console.warn('[changelog] DeepSeek request timed out, using local summary.');
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

  // Only publish what a normal user can notice.
  const userFacing = commits.filter(isUserFacingCommit);
  if (userFacing.length === 0) {
    console.log('ℹ️  Today\'s commits are internal/developer work only – no user-facing entry.\n');
    return;
  }

  console.log(`📝 ${userFacing.length} user-facing commit(s) found:`);
  userFacing.forEach((c) => console.log(`   • ${extractSubject(c.message)}`));

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
  const changes = await callDeepSeek(userFacing);
  console.log('✅ Summary ready.');

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
  looksMostlySpanish,
  isLowQualityChangelog,
  createFriendlyChanges,
  normalizeCategorizedChanges,
  guessCategoryFromCommit,
  flattenLocalized,
  shouldSkipCommit,
  isInternalPath,
  isUserFacingCommit,
  detectModules,
  humanizeCommitSubject,
  stripLeadingVerb,
  parseGitLog,
  translateToSpanish,
  formatCommitsForPrompt,
  MAX_BULLETS_PER_LANGUAGE,
};
