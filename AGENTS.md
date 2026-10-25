# Sionflow — reglas para agentes de IA y CLI

Todo IDE/CLI/agente cloud debe leer estas instrucciones **antes de editar**. La referencia oficial es `AndresDevelopers/Sionflow`, rama `main`. No usar el historial de KVTemplate ni asumir que tests verdes implican ausencia de bugs.

## Secuencia obligatoria

**Clon local con Git:** ejecutar `node scripts/local-regression-gate.mjs --preflight` antes de editar (checkout limpio y `origin/main` disponible). Revisar `git status --short`, `git diff`, `git diff --cached`, `node scripts/local-regression-gate.mjs --report` y el historial de los archivos afectados. Después de editar, antes del commit, ejecutar `node scripts/local-regression-gate.mjs --check-worktree`. Tras el commit ejecutar `--check`; el hook `pre-push` refuerza el push. Instalar hooks una vez por clon con `node scripts/setup-hooks.js` (conserva el post-commit del changelog).

**Agentes en cloud con terminal y checkout Git:** ejecutar `node scripts/cloud-regression-gate.mjs --prepare` antes de editar, `--report` durante el análisis y `--verify` al finalizar. Solamente está autorizado consultar origin y hacer fetch de lectura del remoto oficial de `main` al ref remoto local `origin/main`. No hacer reset, rebase, merge, force-push, ni reescribir Git para pasar tests.

**Agentes solo con GitHub API o sin clon Git:** comparar por API los SHA oficiales de `main`, HEAD, merge-base/diff del PR, pruebas existentes y checks reales. No afirmar que se ejecutó un hook o test de terminal. Si no hay historia Git, se permite `node scripts/local-regression-gate.mjs --check-snapshot` como **validación parcial sin comparación histórica**. Transferir el cambio a un clon auténtico y PR con CI antes de fusionarlo.

## Contratos protegidos

- No alterar ni deshabilitar tests, mocks, fixtures, snapshots, cobertura o gates de CI para ocultar fallos. Primero corregir implementación. Para editar tests previos, solicitar aprobación del propietario; en local él ejecuta `--approve-tests`, después de revisar el diff y el commit. Nunca lo ejecuta la IA.
- Cambios en hooks, AGENTS.md, scripts de protección, workflows, Firebase rules o configuraciones se proponen por PR. En el servidor se requieren etiquetas `tests-change-approved` / `ci-config-change-approved` según el cambio y comentario exacto `CI-POLICY-APPROVE <SHA_COMPLETO_ACTUAL>` de un maintainer. Ninguna IA coloca esos permisos por sí misma.
- Preservar Firestore/Storage rules, aislamiento por `barrioOrg`, roles, acceso a miembros, autenticación, avisos, notificaciones y PWA. No usar datos, secretos ni Firebase de producción en pruebas. Los cambios de reglas deben incluir pruebas con Firebase Emulator o evidencia explícita de su no ejecución.
- No editar producción, migrar datos, hacer deploy ni fusionar PR sin autorización humana. No usar `--no-verify`, `git push --force`, `git reset --hard` o tests `.skip` para evadir controles.
- Antes del PR, indicar SHA base y HEAD, archivos, riesgos, tests realmente ejecutados/no ejecutados, fallos, pruebas anteriores modificadas y pendientes. Exigir checks en el SHA actual; rojo, ausente o pendiente NO es aprobación.

Guía: [docs/PROTECCIONES_GIT_Y_IA.md](docs/PROTECCIONES_GIT_Y_IA.md).
