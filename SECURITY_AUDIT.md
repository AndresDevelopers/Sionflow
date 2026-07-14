# Auditoría de Seguridad — SionFlow

> Documento vivo con checklist para remediación asistida por IA.
> Marca `[x]` los ítems conforme se resuelvan. Cada hallazgo incluye los pasos exactos de remediación como sub-checkboxes.

**Última revisión de código:** 2026-07-14  
**Leyenda de severidad:** 🔴 CRÍTICO · 🟠 ALTO · 🟡 MEDIO · 🟢 BAJO

**Alcance:** `src/` (auth, API routes, UI), `functions/`, `firestore.rules`, `storage.rules`, configs de despliegue y repo hygiene.

---

## Resumen ejecutivo (estado actual)

SionFlow es multi-tenant por `barrioOrg` (`barrio|organización`) sobre Next.js + Firebase.

**Ya remediado (código actual):**

- Auth server-side en APIs de miembros, push, external y sugerencias vía `requireUid` / `requireUidAndBarrioOrg` (`src/lib/api-auth.ts`).
- Queries Admin SDK de miembros **exigen** `barrioOrg` (fail closed; sin listado global).
- Reportes callable resuelven `barrioOrg` desde `c_users` (no confían en el cliente).
- Firestore: colecciones de negocio con `isSameBarrio()`; default deny; self-update no puede cambiar `barrioOrg`/`barrio`/`organizacion`/`role`/`permission`.
- `c_notifications`: lectura solo del dueño; create exige `barrioOrg` + mismo tenant.
- Storage: write acotado a `users/{userId}/**` (y paths legacy con `userId`); sin write global.
- Cloud Functions `getEligibleUsers`: **no** notifica si el documento no tiene `barrioOrg` (evita fuga cross-tenant en legacy).
- Crons (`birthday-notifications`, `deceased-members-ordinances`) exigen `CRON_SECRET` (fail closed si falta).
- Push/FCM de API: solo destinatarios del `barrioOrg` del llamador.
- Migración de docs sin `barrioOrg`: Admin API `/api/admin/migrate-barrio-org` (liderazgo, solo el tenant del llamador).

**Riesgos abiertos prioritarios:** SSRF en `/api/download-qr` y `fetchImageBuffers`, falta de middleware edge, secrets en working tree local, CI/typecheck en build, y auth en church-chat (costo).

---

## 🔴 CRÍTICOS

### C1. PII completa de todos los miembros sin autenticación — ✅ REMEDIADO
- **Ubicación:** `src/app/api/members/route.ts`
- **Problema (histórico):** `GET` sin auth + Admin SDK sin filtro → PII de todos los barrios.
- [x] Verificación de token (`requireUidAndBarrioOrg` → `authAdmin.verifyIdToken`).
- [x] Scope por `barrioOrg` del usuario autenticado (ignorando query string del cliente).
- [x] Rechazo si el perfil no tiene barrio/org (`AuthHttpError` 403).
- [x] `fetchMembers` lanza error si falta `barrioOrg` (nunca query global).
- [x] PUT/DELETE en `members/[id]` comprueban `member.barrioOrg === callerBarrioOrg`.

### C2. SSRF en `/api/download-qr` — ⬜ ABIERTO
- **Ubicación:** `src/app/api/download-qr/route.ts`
- **Problema:** Fetch de URL arbitraria del cliente sin allowlist de host/esquema.
- [ ] Restringir esquema a `https:` únicamente.
- [ ] Allowlist de hosts esperados (host del QR de donaciones).
- [ ] Rechazar rangos IP privados/metadata (`10.x`, `172.16.x`, `192.168.x`, `169.254.x`).
- [ ] Requerir auth o token firmado para el endpoint.

### C3. Endpoint de ordenanzas de fallecidos sin autenticación — ✅ REMEDIADO (cron)
- **Ubicación:** `src/app/api/deceased-members-ordinances/route.ts`
- **Problema (histórico):** sin auth; exposición de nombres + notificaciones.
- [x] Auth por `CRON_SECRET` Bearer (fail closed si no está configurado).
- [x] Push agrupado por `barrioOrg` del miembro; respuesta HTTP sin PII de nombres.
- [x] Rate limiting en el route.
- **Nota:** no es un endpoint de usuario final; es job de cron.

### C4. Broadcast FCM a todos los usuarios sin autenticación — ✅ REMEDIADO
- **Ubicación:** `src/app/api/send-fcm-notification/route.ts`, `send-push-notification/route.ts`
- **Problema (histórico):** sin auth + broadcast global.
- [x] `requireUidAndBarrioOrg`.
- [x] Destinatarios limitados al `barrioOrg` del llamador (o un `userId` del mismo tenant).
- [x] Rate limiting.
- [x] `getTargetUserIds` en server push rechaza broadcast sin `barrioOrg`.

### C5. Reportes callable exponen datos de todos los tenants — ✅ REMEDIADO
- **Ubicación:** `functions/src/index.ts` (`generateCompleteReport`, `generateReport`, `withAuthenticatedReport`)
- **Problema (histórico):** solo `context.auth`; queries sin filtro de ward.
- [x] Tras auth, cargar `c_users` y resolver `barrioOrg` (sin default de barrio de producción).
- [x] Queries de actividades/servicios/bautismos/etc. con `.where("barrioOrg", "==", barrioOrg)`.
- [x] Respuestas de informe por doc id `year|barrioOrg` (legacy solo si coincide barrioOrg).

---

## 🟠 ALTOS

### A1. Sin protección server-side de rutas de página (solo guardas client-side) — ⬜ PARCIAL
- **Ubicación:** `src/app/(main)/layout.tsx`, admin layout — no hay `middleware.ts`
- **Estado:** Las **API routes** de datos sensibles sí validan token + barrio. Las páginas `(main)/*` siguen confiando en auth client-side (UX).
- [ ] Crear `src/middleware.ts` (session cookie / ID token en edge) para `(main)/*`.
- [x] Proteger `/api/*` sensibles con `requireAuth` / `requireUidAndBarrioOrg` (members, external, push, suggestions, storage upload, migrate).
- [ ] Mantener guardas client-side solo como UX.

### A2. Storage write abierto a cualquier path — ✅ REMEDIADO
- **Ubicación:** `storage.rules`, `src/lib/storage-paths.ts`
- **Problema (histórico):** write en cualquier path autenticado.
- [x] Write canónico en `users/{userId}/**` con `request.auth.uid == userId`.
- [x] Paths legacy con segmento `userId` (members, baptism_photos, etc.) solo owner.
- [x] Carpetas planas (`missionary-images/**`) write `false` (solo Admin SDK).
- [x] Límite de tamaño 20 MB e `image/*`.
- [x] Uploads de cliente/servidor usan `userScopedStoragePath()`.

### A3. `barrioOrg` auto-modificable → escalamiento horizontal — ✅ REMEDIADO
- **Ubicación:** `firestore.rules` (`c_users` update)
- [x] Self-update bloquea `role`, `permission`, `barrioOrg`, `barrio`, `organizacion`.
- [x] Leadership solo puede gestionar peers en el mismo `barrioOrg`.

### A4. Colecciones sin regla / catch-all permisivo — ✅ REMEDIADO (diseño actual)
- **Ubicación:** `firestore.rules`
- **Problema (histórico):** default `allow read if signedIn` o colecciones huérfanas.
- [x] Default: `match /{document=**} { allow read, write: if false; }`.
- [x] Colecciones de negocio con reglas explícitas + `isSameBarrio()`.
- [x] `c_sync_signals` read solo mismo barrio; write false (solo Admin/CF).
- **Nota:** no hay match a `c_nuevos_conversos` (si existiera en prod, quedaría deny-by-default).

### A5. Cron abierto si `CRON_SECRET` no está set — ✅ REMEDIADO
- **Ubicación:** `birthday-notifications`, `deceased-members-ordinances`
- [x] Exigir `CRON_SECRET` incondicionalmente; 401 si falta o no coincide.
- [ ] Confirmar en Vercel/prod que la variable está set (operación, no código).

### A6. Endpoint de IA pagado sin autenticación — ⬜ ABIERTO
- **Ubicación:** `src/app/api/church-chat/route.ts`
- **Problema:** riesgo de costo/DoS sin Bearer. Tiene Zod + rate limit.
- [ ] Añadir `requireAuth()` / `requireUid`.
- [x] Rate limiting (`enforceRateLimit`).
- [ ] (Opcional) Cachear respuestas comunes.

### A7. Storage read abierto — ✅ MEJORADO (residual aceptable)
- **Ubicación:** `storage.rules`
- **Estado:** Lectura de `image/*` permitida (necesario para `<img>` sin token de Auth). Las URLs de Firebase llevan download token. Write ya no es global.
- [x] Write scopeado por `userId`.
- [ ] (Opcional) Mover a URLs firmadas de corta vida y quitar read público de imágenes.

### A8. `c_barrios` / `c_organizaciones` escritura por cualquier auth — ✅ REMEDIADO
- **Ubicación:** `firestore.rules`
- [x] Write solo `isSecretary()`.
- [x] Read público (nombres de referencia para registro) — aceptable.

### A9. SSRF en `fetchImageBuffers` (axios sin allowlist) — ⬜ ABIERTO
- **Ubicación:** `functions/src/index.ts` (`fetchImageBuffers` / axios)
- [ ] Allowlist de dominios (Firebase Storage / CDN).
- [ ] Bloquear IP privadas/metadata antes de `axios.get`.
- [ ] Validar resolución DNS del host permitido.

---

## 🟡 MEDIOS

### M1. Credenciales vivas en el working tree — ⬜ OPERACIONAL
- **Ubicación:** `.env.local`, service account JSON (gitignoreados)
- [ ] Rotar service-account y API keys si hubo exposición.
- [ ] Preferir Secret Manager / env de Vercel-Firebase.
- [x] `.gitignore` excluye `.env.local` y `*-firebase-adminsdk-*.json`.

### M2. `typescript.ignoreBuildErrors: true` — ⬜ ABIERTO
- **Ubicación:** `next.config.ts`
- [ ] Quitar `ignoreBuildErrors`.
- [ ] Añadir `tsc --noEmit` en CI antes de build.

### M3. Sin CI / Dependabot / CodeQL — ⬜ ABIERTO
- **Ubicación:** `.github/` (templates; sin workflows de CI)
- [ ] `.github/workflows/ci.yml` (install + lint + typecheck + test).
- [ ] Dependabot.
- [ ] (Opcional) CodeQL.

### M4. Logging verboso de request bodies — ⬜ REVISAR
- **Ubicación:** `src/app/api/members/[id]/route.ts` (si aún loguea body)
- [ ] Loguear solo IDs/campos no sensibles.
- [ ] Nivel debug solo fuera de prod.

### M5. CORS con orígenes de desarrollo — ⬜ REVISAR
- **Ubicación:** `cors.json`
- [ ] Quitar localhost del bucket de producción.
- [ ] Restringir métodos a los necesarios.

---

## 🟢 BAJOS

### B1. `dangerouslySetInnerHTML` en chart — ⬜ VIGILAR
- **Ubicación:** `src/components/ui/chart.tsx`
- [ ] Mantener interpolación no controlada por usuario.
- [ ] Comentario de por qué es seguro.

### B2. Endpoints de sugerencias IA — ✅ REMEDIADO (auth)
- **Ubicación:** `suggestions`, `service-suggestions`
- [x] `requireUidAndBarrioOrg` + scope de actividades/servicios por barrio.
- [x] Rate limiting.
- [x] Cache keys incluyen `barrioOrg`.

### B3. `c_push_subscriptions` write — ✅ REMEDIADO (intención documentada)
- **Ubicación:** `firestore.rules`
- [x] Write/read por `userId == auth.uid` (sin exigir `canWrite()`), para que cualquier rol registre su token push.

### B4. Notificaciones cross-org (legacy / sin barrioOrg) — ✅ REMEDIADO
- **Ubicación:** `functions/src/index.ts` (`getEligibleUsers`), `notification-helpers.ts`, `notification-bell.tsx`
- **Problema (histórico):** docs sin `barrioOrg` notificaban a todos los tenants; campanita mostraba legacy sin scope.
- [x] `getEligibleUsers` fail closed sin `scope` (log warn, cero destinatarios).
- [x] Helpers cliente: `getAllUserIds` / `createNotificationsForAll` exigen `barrioOrg`.
- [x] Campanita filtra solo notificaciones con `barrioOrg` igual al del usuario.
- [x] Create de `c_notifications` exige campo `barrioOrg` en rules.
- [x] Tool de migración Admin para sellar docs legacy: `/api/admin/migrate-barrio-org` + UI admin.

---

## ✅ Controles verificados (baseline multi-tenant)

### Auth API
- [x] `requireAuth` / `requireUid` / `requireUidAndBarrioOrg` / `buildBarrioOrgFromUserData` en `src/lib/api-auth.ts`
- [x] Nunca default a un barrio de producción (p. ej. Libertad) para perfiles incompletos
- [x] `/api/members`, `/api/members/[id]`, `/api/external/*`, push, suggestions, storage upload, migrate-barrio-org

### Firestore
- [x] `isSameBarrio()` en colecciones de datos (`c_miembros`, `c_ministracion`, actividades, etc.)
- [x] `c_users`: peers solo mismo barrio; self-update sin tocar tenant/roles
- [x] `c_notifications`: read solo owner
- [x] `c_admin_audit`: leadership mismo barrio; update/delete false
- [x] `c_barrios` / `c_organizaciones`: write secretary; read público
- [x] Default deny

### Storage
- [x] Write owner-scoped (`users/{userId}/…` + legacy con userId)
- [x] Helper `userScopedStoragePath`

### Cloud Functions / push
- [x] Reportes scoped por `barrioOrg` del llamador
- [x] Notificaciones CF fail closed sin `barrioOrg` del documento
- [x] Push server sin `barrioOrg` → no broadcast global

### Repo / config
- [x] Sin `eval`/`exec`/`child_process`/`new Function` en `src/`
- [x] `.gitignore` de secrets; `firebaseConfig` solo `NEXT_PUBLIC_*`
- [x] `SECURITY.md` y este audit presentes

---

## Orden de remediación restante (recomendado)

1. **C2, A9** — cerrar SSRF (allowlist host/IP).
2. **A6** — `requireAuth` en church-chat.
3. **A1** — middleware edge para páginas `(main)`.
4. **M1** — rotar secrets locales si aplica; no commitear.
5. **M2, M3** — typecheck en build + CI/Dependabot.
6. **M4, M5, B1** — logging, CORS, chart.

---

## Despliegue de reglas y functions

Tras cambios en aislamiento multi-tenant, desplegar:

```bash
firebase deploy --only firestore:rules,storage
firebase deploy --only functions
# + deploy de la app (Vercel/hosting)
```

Migrar documentos legacy sin `barrioOrg` desde **Admin → Migrar** (solo sella con el `barrioOrg` del usuario autenticado).

---

## Historial de revisiones

| Fecha | Cambio |
|-------|--------|
| 2026-07-14 | Re-auditoría: C1/C3/C4/C5, A2–A5/A8, B2–B4 marcados remediados; resumen y controles multi-tenant actualizados. |
| (previo) | Auditoría inicial con hallazgos C1–C5 y A1–A9 abiertos. |
