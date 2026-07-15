# 🔒 Plan de Corrección de Vulnerabilidades de Seguridad

## Resumen de las 6 alertas

| # | Paquete | Severidad | Vulnerabilidad | Ubicación |
|---|---------|-----------|----------------|-----------|
| 1 | `serialize-javascript` | **High** | RCE via RegExp.flags y Date.prototype.toISOString() | `pnpm-lock.yaml` (raíz) |
| 2 | `serialize-javascript` | Moderate | CPU Exhaustion DoS via crafted array-like objects | `pnpm-lock.yaml` (raíz) |
| 3 | `uuid` | Moderate | Missing buffer bounds check en v3/v5/v6 | `pnpm-lock.yaml` (raíz) |
| 4 | `uuid` | Moderate | Missing buffer bounds check en v3/v5/v6 | `functions/pnpm-lock.yaml` |
| 5 | `postcss` | Moderate | XSS via `</style>` sin escapar en CSS Stringify | `pnpm-lock.yaml` (raíz) |
| 6 | `body-parser` | Moderate | DoS cuando se usa url encoding | `pnpm-lock.yaml` (raíz) |

---

## Cambios a realizar

### 1. `/package.json` (raíz)

**A. Actualizar dependencia directa:**
- `@google-cloud/functions-framework`: `^4.0.1` → `^5.0.5`
  - Esto resuelve `body-parser` vulnerable que viene de `express` interno de v4.x

**B. Agregar 3 nuevas entradas en `overrides`:**
```json
"serialize-javascript": "^7.0.7",
"postcss": "^8.5.19",
"body-parser": "^2.3.0"
```
- `serialize-javascript`: Fuerza v7.0.7 (compatible con `@rollup/plugin-terser@0.4.4` que declara `^7.0.3`)
- `postcss`: Fuerza v8.5.19 sobre el `postcss@8.4.31` empaquetado por Next.js 16.2.10
- `body-parser`: Red de seguridad adicional

### 2. `/functions/package.json`
- **Sin cambios necesarios** — el override `"uuid": "^14.0.0"` ya existe, pero el lock file está desactualizado.

### 3. Regenerar lock files
```bash
cd /backup/Documentos/Personal/Sionflow
pnpm install                    # Regenera pnpm-lock.yaml raíz
cd functions && pnpm install    # Regenera functions/pnpm-lock.yaml
```

### 4. Verificación
```bash
pnpm why serialize-javascript   # Debe mostrar solo v7.x
pnpm why uuid                   # Debe mostrar solo v14.x
pnpm why postcss                # Debe mostrar solo v8.5.x
pnpm why body-parser            # Debe mostrar solo v2.3.x
pnpm build                      # Verificar que la build no se rompe
```

---

## Notas importantes
- `@google-cloud/functions-framework` en la raíz **no se usa en ningún archivo fuente** (solo está en `package.json`). Se actualiza en lugar de eliminar por precaución.
- El `uuid@14.0.0` ya está como override pero el lock file tiene versiones antiguas (8.3.2, 9.0.1). Con `pnpm install` se resolverá.
- `postcss` es 100% backward-compatible entre 8.4.x y 8.5.x — no debería romper Next.js.