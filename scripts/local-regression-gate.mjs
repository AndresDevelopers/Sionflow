/**
 * Local, opt-in pre-push regression gate. CI remains the authoritative gate.
 * Compares committed changes to the merge-base with origin/main and tests
 * the entire existing unit/regression suite, not merely changed test files.
 * --preflight and --check-worktree add non-certifying WIP checks; --check-snapshot
 * checks code without any Git history and is NEVER a push/merge certification.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const zeroSha = /^0{40}$/;
const testPattern = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/i;

/** Parse git diff --name-status -z including renamed or copied paths. */
export function parseNameStatusZ(input) {
  const fields = input.toString("utf8").split("\0");
  if (fields.at(-1) === "") fields.pop();
  const changes = [];
  for (let i = 0; i < fields.length;) {
    const status = fields[i++];
    if (!/^(?:A|M|D|T|U|R\d*|C\d*)$/.test(status || "")) {
      throw new Error(`Estado de diff no reconocido: ${JSON.stringify(status)}`);
    }
    const previousPath = /^[RC]/.test(status) ? fields[i++] : null;
    const path = fields[i++];
    if (!path || (previousPath !== null && !previousPath)) {
      throw new Error("Diff de Git incompleto; no se omitirán cambios.");
    }
    changes.push({ status, path, previousPath });
  }
  return changes;
}

/** Enumerate untracked paths without splitting on newlines or trusting Git output formatting. */
export function parseUntrackedFilesZ(input) {
  const raw = input.toString("utf8");
  if (raw && !raw.endsWith("\0")) throw new Error("Listado NUL de archivos nuevos incompleto.");
  return raw.split("\0").filter(Boolean).map((path) => ({ status: "A", path, previousPath: null }));
}

/** Staged + unstaged tracked files, plus untracked files; read-only inspection. */
function workingTreeChanges() {
  const tracked = execFileSync("git", ["diff", "--name-status", "-z", "--find-renames", "HEAD"], {
    cwd: root, maxBuffer: 16 * 1024 * 1024,
  });
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: root, maxBuffer: 16 * 1024 * 1024,
  });
  return [...parseNameStatusZ(tracked), ...parseUntrackedFilesZ(untracked)];
}

/** WIP inspections must accept dirty tracked files; commit/push certification must not. */
export function requiresCleanTrackedTree(mode) {
  return !["--report", "--preflight", "--check-worktree"].includes(mode);
}

export function isProtectedTest(path) {
  return path.startsWith("tests/e2e/") || testPattern.test(path) || /(?:^|\/)(?:__mocks__|__fixtures__|__snapshots__|fixtures|mocks)(?:\/|$)/.test(path);
}

/** Conservative: uncertain non-documentation changes trigger full suite. */
export function planChanges(changes) {
  const modifiedTests = [];
  const allTests = new Set();
  const riskFiles = [];
  for (const change of changes) {
    const paths = [change.path, change.previousPath].filter(Boolean);
    if (paths.some(isProtectedTest)) {
      allTests.add(change.path);
      if (change.status !== "A") modifiedTests.push(change);
    }
    const documentationOnly = paths.every((path) =>
      /^(?:docs\/|\.vscode\/)/.test(path) ||
      /^(?:README\.md|SECURITY\.md)$/.test(path) ||
      /\.(?:md|mdx)$/.test(path) && !/^(?:AGENTS|RULES)\.md$/.test(path) && !path.startsWith(".github/")
    );
    if (!documentationOnly) riskFiles.push(change.path);
  }
  return { shouldTest: riskFiles.length > 0, riskFiles, modifiedTests, testFiles: [...allTests] };
}

/** Safety machinery must be reviewed in a PR; self-approval from this hook is unsafe. */
export function isProtectedGuardPath(path) {
  return /^(?:\.githooks\/|\.github\/workflows\/|\.github\/instructions\/|\.github\/agents\/|\.kilo\/)/.test(path) ||
    /^(?:AGENTS\.md|RULES\.md|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|vitest\.config\.ts|eslint\.config\.mjs|tsconfig\.json|firebase\.json|firestore\.rules|storage\.rules)$/.test(path) ||
    /^scripts\/(?:local-regression-gate(?:\.spec)?|cloud-regression-gate(?:\.spec)?|ci-policy-guard(?:\.spec)?)\.mjs$/.test(path) ||
    /^scripts\/setup-hooks\.js$/.test(path);
}

export function protectedGuardChanges(changes) {
  return changes.filter(({ path, previousPath }) => [path, previousPath].filter(Boolean).some(isProtectedGuardPath));
}
/** Validate the actual remote SHA provided by Git, not a stale remote-tracking ref. */
export function checkPrePushInput(input, currentHead = null) {
  const lines = input.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) throw new Error("El hook no recibió referencias del push.");
  const pushes = [];
  for (const line of lines) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4 || !/^[0-9a-f]{40}$/.test(fields[1]) || !/^[0-9a-f]{40}$/.test(fields[3])) {
      throw new Error("Referencias de pre-push inválidas.");
    }
    const [localRef, localSha, remoteRef, remoteSha] = fields;
    if (zeroSha.test(localSha) || !localRef.startsWith("refs/heads/") || !remoteRef.startsWith("refs/heads/")) {
      throw new Error("El hook solo verifica pushes de ramas existentes; no se permite borrado de ramas.");
    }
    if (currentHead && localSha !== currentHead) {
      throw new Error("El push no coincide con el HEAD del checkout actual. Cambia a esa rama y vuelve a validar.");
    }
    const production = remoteRef === "refs/heads/main" || remoteRef === "refs/heads/main";
    if (production && (localRef !== remoteRef || zeroSha.test(remoteSha))) {
      throw new Error("Para publicar la rama principal usa su rama local y una rama remota ya existente.");
    }
    pushes.push({ localRef, localSha, remoteRef, remoteSha, production });
  }
  if (pushes.length > 1) throw new Error("Envia una rama por push para certificar exactamente su HEAD.");
  return pushes[0];
}

/** Bound to base, HEAD, exact protected file statuses and byte-level test diff. */
export function approvalFingerprint({ baseSha, headSha, testChanges, testPatch }) {
  if (![baseSha, headSha].every((sha) => /^[0-9a-f]{40}$/.test(sha))) throw new Error("SHA de aprobación inválido.");
  if (!Array.isArray(testChanges) || testChanges.length === 0) throw new Error("No hay tests para aprobar.");
  return createHash("sha256").update(JSON.stringify({ version: 1, baseSha, headSha, testChanges, testPatch })).digest("hex");
}

export function approvalMatches(raw, expected) {
  if (!raw || !expected) return false;
  try {
    const parsed = JSON.parse(raw);
    return parsed.version === 1 && parsed.fingerprint === expected.fingerprint &&
      parsed.baseSha === expected.baseSha && parsed.headSha === expected.headSha;
  } catch { return false; }
}

function protectedTestPatch(baseSha, headSha, changes) {
  const paths = [...new Set(changes.flatMap(({ path, previousPath }) => [path, previousPath].filter(Boolean)))].sort();
  return execFileSync("git", ["diff", "--binary", "--full-index", "--find-renames", baseSha, headSha, "--", ...paths], {
    cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  });
}

function approvalRecord(baseSha, headSha, plan) {
  const testChanges = plan.modifiedTests.map(({ status, path, previousPath }) => ({ status, path, previousPath }));
  const testPatch = protectedTestPatch(baseSha, headSha, testChanges);
  return { version: 1, baseSha, headSha, fingerprint: approvalFingerprint({ baseSha, headSha, testChanges, testPatch }), testPatch };
}

function storedApproval() {
  try { return git(["config", "--local", "--get", "sionflow.test-changes-approval"]); }
  catch { return ""; }
}

/** Read from a real terminal, not stdin (pre-push uses stdin for refs). */
function confirmOnTerminal(challenge) {
  const tty = process.platform === "win32" ? "CONIN$" : "/dev/tty";
  let fd;
  try { fd = openSync(tty, "r"); }
  catch { throw new Error("No hay terminal interactiva. Ejecuta --approve-tests tú mismo desde una terminal real."); }
  try {
    process.stdout.write("\nEsta operación autoriza cambiar contratos de tests EXISTENTES.\n");
    process.stdout.write(`Escribe exactamente: ${challenge}\n> `);
    const buffer = Buffer.alloc(1);
    let answer = "";
    while (answer.length < 180) {
      const count = readSync(fd, buffer, 0, 1, null);
      if (count !== 1 || buffer[0] === 10 || buffer[0] === 13) break;
      answer += buffer.toString("utf8", 0, count);
    }
    if (answer.trim() !== challenge) throw new Error("Confirmación no coincide; los tests siguen sin aprobar.");
  } finally { closeSync(fd); }
}

function approveTestChanges({ baseSha, headSha, plan }) {
  if (!plan.modifiedTests.length) { console.log("[regresión] No hay tests existentes modificados que aprobar."); return; }
  const record = approvalRecord(baseSha, headSha, plan);
  console.log("[regresión] CAMBIOS EN PRUEBAS EXISTENTES (revisa ANTES de aprobar):");
  process.stdout.write(record.testPatch);
  const challenge = `APRUEBO TESTS ${headSha.slice(0, 12)} ${record.fingerprint.slice(0, 12)}`;
  confirmOnTerminal(challenge);
  // Local-only Git config; it is NOT a signature or a GitHub review.
  git(["config", "--local", "--replace-all", "sionflow.test-changes-approval",
    JSON.stringify({ version: 1, baseSha, headSha, fingerprint: record.fingerprint })]);
  console.log(`[regresión] Aprobación local registrada para HEAD ${headSha.slice(0, 12)}. Cambiar un commit o la base la invalida.`);
  console.log("[regresión] Esta aprobación NO sustituye etiquetas y comentario SHA en un PR.");
}

/** Regression quality stages; the production path may not drop critical E2E. */
export function gateCommands(strict, shouldTest) {
  if (!strict && !shouldTest) return [];
  const selfTests = { bin: "node", args: ["--test", "scripts/local-regression-gate.spec.mjs", "scripts/cloud-regression-gate.spec.mjs", "scripts/ci-policy-guard.spec.mjs"], mode: "test" };
  const unit = { bin: "pnpm", args: ["test"], mode: "test" };
  const types = { bin: "pnpm", args: ["typecheck"], mode: "test" };
  if (!strict) return [selfTests, unit, types];
  return [
    selfTests, unit, types,
    { bin: "pnpm", args: ["test:roles"], mode: "test" },
    { bin: "pnpm", args: ["check:i18n"], mode: "test" },
    { bin: "pnpm", args: ["lint"], mode: "test" },
    { bin: "pnpm", args: ["audit", "--audit-level=high"], mode: "test" },
    { bin: "pnpm", args: ["exec", "next", "build", "--webpack"], mode: "build" },
  ];
}

/** Never pass production credentials to local unit, build, or browser runs.
 * Next may read .env.local, so blank its keys before starting processes.
 */
function isolatedEnv(mode) {
  const allowed = ["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR", "XDG_CACHE_HOME", "PNPM_HOME", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "TERM", "CI", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"];
  const env = Object.fromEntries(allowed.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
  for (const file of [".env", ".env.local", ".env.test", ".env.test.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local"]) {
    const location = resolve(root, file);
    if (!existsSync(location)) continue;
    for (const line of readFileSync(location, "utf8").split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (match) env[match[1]] = "";
    }
  }
  Object.assign(env, {
    NEXT_PUBLIC_FIREBASE_API_KEY: "dummy-sionflow-test-key",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-sionflow.firebaseapp.com",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-sionflow",
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "demo-sionflow.appspot.com",
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "1234567890",
    NEXT_PUBLIC_FIREBASE_APP_ID: "1:1234567890:web:demo",
    NEXT_PUBLIC_SITE_URL: "http://localhost:9001",
    FIREBASE_SERVICE_ACCOUNT_KEY: "",
    GOOGLE_APPLICATION_CREDENTIALS: "",
    GOOGLE_CLOUD_PROJECT: "demo-sionflow",
    DEEPSEEK_API_KEY: "",
    GEMINI_API_KEY: "",
    GOOGLE_GENERATIVE_AI_API_KEY: "",
    RESEND_API_KEY: "",
    APP_ADMIN_EMAIL: "",
    APP_ADMIN_PASSWORD: "",
    APP_ADMIN_BOOTSTRAP_SECRET: "",
    CRON_SECRET: "",
    NEXT_TELEMETRY_DISABLED: "1",
  });
  if (mode === "test") env.NODE_ENV = "test";
  if (mode === "build") env.NODE_ENV = "production";
  return env;
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();
}

function run(bin, args, env) {
  // Windows cannot execute .cmd files using shell:false; all args are static.
  const windowsPnpm = process.platform === "win32" && bin === "pnpm";
  const command = windowsPnpm ? (process.env.ComSpec || "cmd.exe") : bin;
  const commandArgs = windowsPnpm ? ["/d", "/s", "/c", ["pnpm", ...args].join(" ")] : args;
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit", shell: false, env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${bin} ${args.join(" ")} falló (${result.status ?? result.signal}).`);
}

function main() {
  const mode = process.argv[2] || "--report";
  if (!["--report", "--preflight", "--check-worktree", "--check-snapshot", "--check", "--check-main", "--approve-tests", "--pre-push"].includes(mode) || process.argv.length > 3) {
    throw new Error("Uso: node scripts/local-regression-gate.mjs [--report|--preflight|--check-worktree|--check-snapshot|--check|--check-main|--approve-tests|--pre-push]");
  }
  // This non-certifying escape hatch intentionally performs NO Git operation.
  // It is never selected by --check, --check-main, --approve-tests or --pre-push.
  if (mode === "--check-snapshot") {
    console.warn("[regresión] VERIFICACIÓN PARCIAL SIN HISTORIAL GIT (--check-snapshot).");
    console.warn("[regresión] NO se comparó con main/HEAD, ni se verificaron modificaciones de tests previos, ni aprobaciones de cambios.");
    console.warn("[regresión] Este resultado NUNCA autoriza push, merge, modificación de tests anteriores ni publicación. Trabaja sobre un clon Git y abre PR con CI.");
    for (const stage of gateCommands(false, true)) {
      console.log(`[regresión] Ejecutando en entorno aislado: ${stage.bin} ${stage.args.join(" ")}`);
      run(stage.bin, stage.args, isolatedEnv(stage.mode));
    }
    console.log("[regresión] VERIFICACIÓN PARCIAL COMPLETADA: pruebas unitarias/cobertura y TypeScript ejecutados; historial, diff, permisos y E2E NO VERIFICADOS.");
    return;
  }
  let head;
  try { head = git(["rev-parse", "--verify", "HEAD"]); }
  catch { throw new Error("No hay repositorio Git válido con un commit HEAD. Para comprobar el código SIN historial usa --check-snapshot (parcial, sin certificación); para subir cambios usa un clon Git y PR."); }
  const push = mode === "--pre-push" ? checkPrePushInput(readFileSync(0, "utf8"), head) : null;
  const strict = Boolean(push?.production || mode === "--check-main");
  if (strict && !["main"].includes(git(["symbolic-ref", "--short", "HEAD"]))) {
    throw new Error("Para verificar main, cambia primero a la rama principal local.");
  }
  if (requiresCleanTrackedTree(mode) && git(["status", "--porcelain", "--untracked-files=no"])) {
    throw new Error("Hay cambios rastreados sin commit. No se verifican archivos diferentes al push.");
  }
  if ((strict || mode === "--approve-tests") && git(["ls-files", "--others", "--exclude-standard"])) {
    throw new Error("Hay archivos sin seguimiento; confirma o elimina esos archivos antes de certificar main.");
  }
  const baseRef = process.env.SION_REGRESSION_BASE || "origin/main";
  let sourceSha;
  try { sourceSha = push?.production ? push.remoteSha : git(["rev-parse", "--verify", `${baseRef}^{commit}`]); }
  catch { throw new Error(`No existe la referencia base ${baseRef}. Un clon Git puede recuperarla con 'git fetch origin main' (si autorizas). Mientras tanto, --check-snapshot solo valida el código, SIN certificar Git, tests previos o push.`); }
  if (!/^[0-9a-f]{40}$/.test(sourceSha) || zeroSha.test(sourceSha)) throw new Error("SHA base inválido.");
  if (strict) {
    // Ref supplied by pre-push is authoritative. Fail closed if unavailable/divergent.
    try {
      git(["merge-base", "--is-ancestor", sourceSha, head]);
    } catch {
      throw new Error("El main remoto no es ancestro de HEAD o el SHA remoto no está disponible. Haz fetch/rebase sin forzar historial.");
    }
  }
  const approvalOnMaster = mode === "--approve-tests" && ["main"].includes(git(["symbolic-ref", "--short", "HEAD"]));
  if (approvalOnMaster) {
    try { git(["merge-base", "--is-ancestor", sourceSha, head]); }
    catch { throw new Error("Actualiza origin/main; no se puede aprobar contra una base divergente."); }
  }
  let diffBase;
  try { diffBase = strict || approvalOnMaster ? sourceSha : git(["merge-base", sourceSha, head]); }
  catch { throw new Error("No hay un ancestro común entre HEAD y la base Git. Revisa si falta historial (shallow clone) sin hacer reset ni reescribir commits."); }
  if (!/^[0-9a-f]{40}$/.test(diffBase)) throw new Error("No se pudo resolver base de comparación.");
  const changes = parseNameStatusZ(execFileSync("git", ["diff", "--name-status", "-z", "--find-renames", diffBase, head], {
    cwd: root, maxBuffer: 16 * 1024 * 1024,
  }));
  const plan = planChanges(changes);
  const working = ["--report", "--preflight", "--check-worktree"].includes(mode) ? workingTreeChanges() : [];
  const workingPlan = planChanges(working);
  const protectedGuards = protectedGuardChanges(changes);
  if (protectedGuards.length) {
    console.warn("[regresión] Cambios en mecanismos de protección (requieren revisión por PR):");
    for (const entry of protectedGuards) console.warn(`  ${entry.status} ${entry.previousPath ? entry.previousPath + " -> " : ""}${entry.path}`);
    if (strict || (mode === "--approve-tests" && ["main"].includes(git(["symbolic-ref", "--short", "HEAD"])))) {
      throw new Error("No se permiten cambios directos de hooks, CI, instrucciones o controles críticos en main. Crea un PR con autorización humana.");
    }
  }
  console.log(`[regresión] Base ${push?.production ? "SHA remoto real" : baseRef} (${diffBase.slice(0, 12)}). Archivos confirmados cambiados: ${changes.length}.`);
  if (working.length) {
    console.log(`[regresión] Cambios locales SIN incluir en HEAD: ${working.length} (rastreados + nuevos sin seguimiento).`);
    for (const item of working) {
      console.log(`  ${item.status} ${item.previousPath ? item.previousPath + " -> " : ""}${item.path}`);
    }
    if (workingPlan.modifiedTests.length) {
      console.warn("[regresión] ATENCIÓN: hay tests/fixtures existentes modificados localmente; requieren autorización antes de editarlos y aprobación del propietario para el push.");
    }
  } else if (["--report", "--preflight", "--check-worktree"].includes(mode)) {
    console.log("[regresión] Árbol de trabajo sin cambios rastreados ni archivos nuevos.");
  }
  if (plan.modifiedTests.length) {
    console.warn("[regresión] Tests/fixtures existentes modificados, renombrados o borrados:");
    for (const entry of plan.modifiedTests) console.warn(`  ${entry.status} ${entry.previousPath ? entry.previousPath + " -> " : ""}${entry.path}`);
  }
  if (mode === "--approve-tests") {
    approveTestChanges({ baseSha: diffBase, headSha: head, plan });
    return;
  }
  if (plan.modifiedTests.length && !["--report", "--preflight", "--check-worktree"].includes(mode)) {
    const record = approvalRecord(diffBase, head, plan);
    if (!approvalMatches(storedApproval(), record)) {
      throw new Error("Tests existentes modificados sin aprobación local válida. Revisa el diff y ejecuta manualmente: node scripts/local-regression-gate.mjs --approve-tests");
    }
    console.log("[regresión] Aprobación LOCAL de los tests verificada para este commit y base.");
    if (!strict) console.log("[regresión] En el PR también son obligatorias la etiqueta y la aprobación SHA de GitHub.");
  }
  if (mode === "--report") {
    console.log(plan.shouldTest || workingPlan.shouldTest ? "[regresión] Hay cambios de código: usa --check-worktree durante la edición y --check tras hacer commit." : "[regresión] Sin cambios de código detectados; --report NO ejecuta pruebas.");
    for (const path of plan.riskFiles) console.log(`  Revisar contrato: ${path}`);
    return;
  }
  if (mode === "--preflight" || mode === "--check-worktree") {
    if (mode === "--preflight" && working.length) {
      throw new Error("La línea base inicial requiere el árbol limpio. Revisa los cambios existentes sin descartarlos o ejecuta --check-worktree (no certifica línea base).");
    }
    try {
      if (git(["rev-parse", "--is-shallow-repository"]) === "true") {
        console.warn("[regresión] Historial shallow: solo se conoce parcialmente el pasado. Si falta información histórica, amplía el fetch sin reescribir commits.");
      }
    } catch { /* Git antiguo; la base SHA ya fue validada. */ }
    console.log(mode === "--preflight"
      ? "[regresión] Línea base ANTES de editar: suite unitaria y typecheck con credenciales ficticias."
      : "[regresión] Validación de cambios SIN commit: suite unitaria y typecheck aislados. NO aprueba tests ni certifica un push.");
    for (const stage of gateCommands(false, true)) {
      console.log(`[regresión] Ejecutando: ${stage.bin} ${stage.args.join(" ")}`);
      run(stage.bin, stage.args, isolatedEnv(stage.mode));
    }
    console.log(mode === "--preflight"
      ? "[regresión] Línea base comprobada en este momento. No garantiza que los cambios futuros no generen regresiones."
      : "[regresión] Pruebas locales completadas. Después del commit siguen siendo obligatorios el gate de push y el CI del PR.");
    return;
  }
  if (!strict && !plan.shouldTest) {
    console.log("[regresión] Solo documentación en rama feature; no se ejecutan tests de aplicación.");
    return;
  }
  console.log(strict ? "[regresión] Push directo a main: controles de tests, roles, lint, auditoría y build sintético aislado (sin credenciales reales)." : "[regresión] Rama de desarrollo: tests unitarios y TypeScript.");
  for (const stage of gateCommands(strict, plan.shouldTest)) {
    console.log(`[regresión] Ejecutando: ${stage.bin} ${stage.args.join(" ")}`);
    run(stage.bin, stage.args, isolatedEnv(stage.mode));
  }
  if (git(["rev-parse", "HEAD"]) !== head || git(["status", "--porcelain", "--untracked-files=no"])) {
    throw new Error("El árbol Git cambió mientras se ejecutaban las pruebas. Vuelve a confirmar y verificar.");
  }
  console.log(strict ? "[regresión] Main: las comprobaciones locales configuradas pasaron; GitHub CI aún debe validar el commit." : "[regresión] Tests locales aprobados; GitHub CI/E2E siguen siendo obligatorios en el PR.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error("[regresión] BLOQUEADO: " + error.message); process.exitCode = 1; }
}
