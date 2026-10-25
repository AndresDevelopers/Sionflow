# Manual de protección Git, PR y agentes IA — Sionflow

Estas protecciones replican el modelo de KVTemplate adaptado a **Sionflow**, `main`, pnpm/Node 22, Firebase/Firestore y su hook de changelog. No se ha configurado protección obligatoria de rama desde estos archivos.

## En cada equipo / IDE / CLI

1. Clona Sionflow normalmente, instala Node 22/pnpm y ejecuta `pnpm install --frozen-lockfile`.
2. Instala/verifica hooks: `node scripts/setup-hooks.js` (esto **no** sustituye el post-commit existente).
3. Antes de cambiar código: `node scripts/local-regression-gate.mjs --preflight`. Si ya hay cambios, usar `--report` y `--check-worktree`, nunca perder cambios ajenos.
4. Antes de hacer commit: `node scripts/local-regression-gate.mjs --check-worktree`. Después del commit: `node scripts/local-regression-gate.mjs --check`.
5. En un push, `.git/hooks/pre-push` corre el gate. En un push directo a `main`, se rechazan los cambios directos a las protecciones y se ejecutan unitarios, roles, i18n, lint, TypeScript, auditoría y compilación sintética. **No** evita bypass con `--no-verify` o un Git cliente sin hooks.

Si no está configurado `origin/main`: actualizar la referencia por los medios aprobados (`git fetch origin main`) o consultar al propietario. No inventar historial. Un ZIP sin Git permite únicamente `--check-snapshot` (tests y tipos sin certificación Git), luego trasladar el diff a un clon Git auténtico.

## Editar un test anterior

La IA debe explicar qué test existe y por qué cambiaría su contrato. El propietario revisa y confirma el commit, y **desde una terminal local real** ejecuta:

```bash
node scripts/local-regression-gate.mjs --approve-tests
```

El script pide una frase vinculada a SHA base, HEAD y diff. La IA no puede aprobar. En el PR el maintainer además aplica `tests-change-approved` y comenta `CI-POLICY-APPROVE <SHA_COMPLETO_DEL_HEAD>`; si el PR cambia CI/hooks/configuración se requiere **también** `ci-config-change-approved`. Cualquier commit nuevo obliga a un comentario SHA actualizado. La política confiable usa `pull_request_target` sin hacer checkout ni ejecutar código del PR.

## Agentes de IA cloud

```bash
node scripts/cloud-regression-gate.mjs --prepare
node scripts/cloud-regression-gate.mjs --report
node scripts/cloud-regression-gate.mjs --verify
```

Verifica origin oficial, consulta SHA remoto de main, actualiza solamente `origin/main`, valida SHA y merge-base, usa el gate local según checkout limpio/sucio y exige PR. Si el origin es otro, falta Git o fetch, **bloquea certificación**. Por API-only compara ramas y CI con GitHub, nunca se inventan ejecuciones.

## Qué revisa GitHub Actions

- `CI / Lint · Typecheck · Tests`: suite de tests del gate, typecheck, lint, tests unitarios y de roles, revisión de dependencias high/critical y build existente.
- `Protected PR Policy`: detecta cambio/eliminación/renombre de tests existentes y cambios a CI, hooks, instrucciones, Firebase rules o configuraciones; exige permiso humano SHA cuando aplica.
- El workflow de política solo podrá aplicarse cuando **se integre por primera vez en la rama base**. Durante el PR que introduce la política hay que revisar manualmente el diff y los checks actuales.
- Si `pnpm audit` detecta vulnerabilidades ya presentes, el check queda rojo hasta resolverlas o cambiar la política con revisión explícita; no se silencian.

Sin reglas de protección de rama, GitHub **no impide técnicamente** push directo o merge con checks fallidos. El propietario debe revisar todos los checks del **HEAD actual** antes de fusionar. Activar checks obligatorios/branch rulesets en GitHub es una decisión administrativa posterior y distinta de este PR. No se tocó Firebase ni producción.
