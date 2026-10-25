/**
 * Cloud-agent regression wrapper. Only refreshes the trusted remote-tracking
 * main ref, then delegates testing to the existing isolated local gate.
 * No production access, branch mutation, auto-approval or merge.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shaPattern = /^[0-9a-f]{40}$/;
const mainRef = "refs/heads/main";
const trackingRef = "refs/remotes/origin/main";

export function isExpectedOrigin(url) {
  // Do not silently compare against a fork's or unrelated repository's main.
  return /^(?:https:\/\/(?:[^/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)AndresDevelopers\/Sionflow(?:\.git)?$/i.test(url.trim());
}

export function advertisedMaster(output) {
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) throw new Error("No se pudo identificar un único main remoto.");
  const match = /^([0-9a-f]{40})\s+refs\/heads\/main$/.exec(lines[0]);
  if (!match || /^0{40}$/.test(match[1])) throw new Error("Respuesta inválida de main remoto.");
  return match[1];
}

export function gateMode(command, dirty) {
  if (command === "--report") return "--report";
  if (command === "--prepare") return dirty ? "--check-worktree" : "--preflight";
  if (command === "--verify") return dirty ? "--check-worktree" : "--check";
  throw new Error("Modo cloud desconocido.");
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();
}

function runGate(mode) {
  const result = spawnSync(process.execPath, [resolve(root, "scripts/local-regression-gate.mjs"), mode], {
    cwd: root, stdio: "inherit", shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("El gate de regresión falló: " + mode + " (" + (result.status ?? result.signal) + ").");
}

function prepareReference() {
  const checkoutRoot = git(["rev-parse", "--show-toplevel"]);
  if (resolve(checkoutRoot) !== root) throw new Error("Debes ejecutar este control en el checkout Git de Sionflow.");
  const head = git(["rev-parse", "--verify", "HEAD^{commit}"]);
  if (!shaPattern.test(head)) throw new Error("HEAD de Git inválido.");
  const origin = git(["remote", "get-url", "origin"]);
  if (!isExpectedOrigin(origin)) {
    throw new Error("origin no corresponde al repositorio oficial de Sionflow. No se consultará un main desconocido.");
  }

  // A read-only network operation as far as the remote repository is concerned.
  // Updates only the local remote-tracking ref; never resets, rebases or merges.
  const advertised = advertisedMaster(git(["ls-remote", "--exit-code", "origin", mainRef]));
  git(["fetch", "--no-tags", "origin", mainRef + ":" + trackingRef]);
  const fetched = git(["rev-parse", "--verify", trackingRef + "^{commit}"]);
  if (fetched !== advertised) throw new Error("main avanzó durante el fetch. Repite la verificación con la base nueva.");

  const mergeBase = git(["merge-base", fetched, head]);
  if (!shaPattern.test(mergeBase)) throw new Error("No se puede comparar HEAD con main: historial Git incompleto.");
  const dirty = Boolean(git(["status", "--porcelain", "--untracked-files=normal"]));
  console.log("[cloud] main oficial: " + fetched);
  console.log("[cloud] HEAD: " + head + "; merge-base: " + mergeBase);
  console.log("[cloud] Estado del checkout: " + (dirty ? "CON CAMBIOS" : "limpio"));
  console.log("[cloud] Comparación: git diff --name-status " + mergeBase + " HEAD y cambios de worktree.");
  return { dirty };
}

function main() {
  const command = process.argv[2];
  if (!["--prepare", "--verify", "--report"].includes(command) || process.argv.length !== 3) {
    throw new Error("Uso: node scripts/cloud-regression-gate.mjs --prepare|--verify|--report");
  }
  const { dirty } = prepareReference();
  if (command === "--prepare" && dirty) {
    console.warn("[cloud] El árbol ya contenía cambios: no existe una línea base limpia anterior a esta sesión. No descartar cambios ajenos.");
  }
  const mode = gateMode(command, dirty);
  console.log("[cloud] Ejecutando el gate existente: " + mode);
  runGate(mode);
  if (command === "--verify" && dirty) {
    console.warn("[cloud] VALIDACIÓN DE WORKTREE, NO CERTIFICACIÓN DE PR. Confirma commits y exige GitHub Actions.");
  }
  console.log("[cloud] No se modificó main ni se aprobó ningún PR. Sin protección de rama, el propietario debe revisar los checks ANTES de fusionar.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error("[cloud] BLOQUEADO: " + error.message);
    console.error("[cloud] Si falta Git/base/permiso de red, solo se permite --check-snapshot (parcial) y un PR revisado con CI.");
    process.exitCode = 1;
  }
}
