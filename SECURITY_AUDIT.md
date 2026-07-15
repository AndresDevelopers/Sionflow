# Auditoría de Seguridad — SionFlow

> Documento vivo con checklist para remediación asistida por IA.
> Marca `[x]` los ítems conforme se resuelvan. Cada hallazgo incluye los pasos exactos de remediación como sub-checkboxes.

**Última revisión de código:** 2026-07-14 (auditoría profunda)  
**Leyenda de severidad:** 🔴 CRÍTICO · 🟠 ALTO · 🟡 MEDIO · 🟢 BAJO

**Alcance:** `src/` (auth, API routes, UI, lib), `functions/`, `firestore.rules`, `storage.rules`, configs de despliegue (Vercel/Firebase), CORS, CSP/headers, repo hygiene (CI, secrets, `.gitignore`).

---

## Resumen ejecutivo (estado actual)

SionFlow es multi-tenant por `barrioOrg` (`barrio|organización`) sobre Next.js + Firebase (Auth, Firestore, Storage, FCM) + Cloud Functions + APIs Next (Admin SDK).

**Ya remediado / verificado en código actual:**

- Auth server-side en APIs de miembros, push, external, suggestions, storage, migrate, app-admin vía `requireAuth` / `requireUid` / `requireUidAndBarrioOrg` / `requireAppAdmin`.
- Queries Admin de miembros **exigen** `barrioOrg` (fail closed; sin listado global).
- Firestore: default deny; colecciones de negocio con `isSameBarrio()`; self-update no puede cambiar `barrioOrg`/`barrio`/`organizacion`/`role`/`permission`; clientes no pueden auto-promoverse a `isAppAdmin`.
- `c_notifications`: lectura solo del dueño; create exige `barrioOrg` + mismo tenant.
- Storage: write acotado a `users/{userId}/**` (+ legacy con userId); sin write global.
- Cloud Functions: `getEligibleUsers` fail closed sin `barrioOrg`; callable `requestDataSyncSignal` scoped al barrio del llamador.
- Crons Vercel (`birthday-notifications`, `deceased-members-ordinances`) exigen `CRON_SECRET` (fail closed si falta).
- Push/FCM de API: destinatarios limitados al `barrioOrg` del llamador + **liderazgo** (`requireLeadership`) + deep links relativos (`sanitizeAppRelativeUrl`).
- App-admin: bootstrap por secreto, impersonate/update-credentials con `requireAppAdmin` + auditoría en `c_admin_audit`.
- Mutaciones Admin de miembros: `requireCanWrite` además de tenant scope.
- IA de costo: `requireUid` en `/api/church-chat` y `/api/analyze-image`.
- Download QR: proxy SSRF-hardened (`src/lib/safe-remote-url.ts`).
- **A9 cerrado:** `fetchImageBuffers` / axios SSRF ya no existen en `functions/`.
- **B1 / B5:** sin sinks de `dangerouslySetInnerHTML` con nombres de usuario en UI de obra misional.

**Riesgos abiertos prioritarios (residuales):**

1. 🟡 **M1** — rotación de secrets locales si hubo exposición (operación).
2. 🟡 **M7** — rate limit en memoria por instancia (Upstash si crece el abuso).
3. 🟢 **B6** — CSP residual (`'unsafe-inline'` / `'unsafe-eval'` en scripts; necesario para Next/Firebase SW).
4. **Deploy app (Vercel)** + aplicar `cors.json` al bucket Storage.

**Remediado en código (2026-07-14/15):** C6 (Firebase), C2, **C7 migrate attribution**, A1, A6, A10–A12, A13 bootstrap lock, B5–B6 img-http, M2–M6, M8 capacity rate, notif URL safety.

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
- [x] POST estampa `barrioOrg` del servidor y borra el del cliente.

### C2. SSRF en `/api/download-qr` — ✅ REMEDIADO
- **Ubicación:** `src/app/api/download-qr/route.ts`, `src/lib/safe-remote-url.ts`
- **Problema (histórico):** `fetch(url)` con URL arbitraria del query string.
- [x] Solo `https:`; sin credenciales en URL.
- [x] Allowlist: `firebasestorage.googleapis.com`, `storage.googleapis.com`, `*.firebasestorage.app`, `*.appspot.com`, host de `NEXT_PUBLIC_SITE_URL`.
- [x] Rechazo de localhost / IPs literales / `.local` / `.internal`.
- [x] `redirect: 'error'` (no seguir redirecciones).
- [x] Content-Type debe ser `image/*`; tope 5 MB; timeout 10 s.
- [x] Rate limiting.
- **Nota:** el link de descarga del donate page es `<a href>` (sin Bearer). La defensa es allowlist, no un proxy abierto. Auth opcional si se migra a descarga vía `fetch`+blob.

### C3. Endpoint de ordenanzas de fallecidos sin autenticación — ✅ REMEDIADO (cron)
- **Ubicación:** `src/app/api/deceased-members-ordinances/route.ts`
- **Problema (histórico):** sin auth; exposición de nombres + notificaciones.
- [x] Auth por `CRON_SECRET` Bearer (fail closed si no está configurado).
- [x] Push agrupado por `barrioOrg` del miembro; respuesta HTTP sin PII de nombres.
- [x] Rate limiting en el route.
- **Nota:** no es un endpoint de usuario final; es job de cron. Confirmar en Vercel que `CRON_SECRET` está set (ver A5).

### C4. Broadcast FCM a todos los usuarios sin autenticación — ✅ REMEDIADO (auth+tenant)
- **Ubicación:** `src/app/api/send-fcm-notification/route.ts`, `send-push-notification/route.ts`
- **Problema (histórico):** sin auth + broadcast global.
- [x] `requireUidAndBarrioOrg`.
- [x] Destinatarios limitados al `barrioOrg` del llamador (o un `userId` del mismo tenant).
- [x] Rate limiting.
- [x] `getTargetUserIds` en server push rechaza broadcast sin `barrioOrg`.
- [x] **A12:** `requireLeadership` + `sanitizeAppRelativeUrl` en envío FCM.

### C5. Reportes callable multi-tenant — ✅ ELIMINADO
- **Ubicación (histórica):** `functions/src/index.ts` (`generateCompleteReport`, `generateReport`, `fetchImageBuffers`)
- **Estado:** feature de reportes DOCX y helpers de descarga de imágenes eliminados del producto.
- **Callable restante:** `requestDataSyncSignal` — auth + `barrioOrg` del perfil; no acepta otro tenant.

### C7. Migración `migrate-barrio-org` reclamaba docs sin atribución — ✅ REMEDIADO
- **Ubicación:** `src/app/api/admin/migrate-barrio-org/route.ts`
- **Problema (histórico):** leadership podía escanear y sellar **cualquier** doc sin `barrioOrg` con su tenant → robo de PII legacy de otros barrios.
- [x] Solo se migran docs **atribuibles**: `barrio`+`organizacion` == tenant del llamador **o** `createdBy`/`userId`/`actorUid` en uids del tenant.
- [x] Docs no atribuibles se reportan como `skippedUnattributable` y **no** se tocan.
- [x] Sigue exigiendo leadership + `targetBarrioOrg === callerBarrioOrg`.

### C6. Update de Firestore puede reasignar `barrioOrg` (robo de documentos entre tenants) — ✅ REMEDIADO Y DESPLEGADO
- **Ubicación:** `firestore.rules` → `canUpdateInBarrio()`, `barrioOrgUnchanged()`, updates de `c_anotaciones` / `c_fs_anotaciones`
- **Problema (histórico):** `canWrite() && (isSameBarrio(resource) || isSameBarrio(request.resource))` permitía a un writer del tenant A reescribir un doc de otro tenant (conociendo el `docId`) y poner `barrioOrg` = el suyo.
- **Código actual:**
  ```
  canWrite()
    && isSameBarrio(resource.data.barrioOrg)
    && request.resource.data.barrioOrg == resource.data.barrioOrg
  ```
- [x] Fail closed: solo el doc **existente** del mismo barrio puede actualizarse.
- [x] `barrioOrg` inmutable en updates de cliente (helper `barrioOrgUnchanged()`).
- [x] Anotaciones (`c_anotaciones`, `c_fs_anotaciones`) también exigen `barrioOrgUnchanged()`.
- [x] Re-sellado de docs legacy sin `barrioOrg` solo vía Admin SDK (`/api/admin/migrate-barrio-org`).
- [x] Desplegado en `quorumflow-dlqh0` (2026-07-14): `firebase deploy --only firestore:rules`.
- [ ] (Opcional) Test de rules con emulador (`@firebase/rules-unit-testing`) para regresión cross-tenant.
- [ ] (Opcional) Desplegar también a `sionflow-dev` si se usa ese proyecto.

---

## 🟠 ALTOS

### A1. Sin protección server-side de rutas de página (solo guardas client-side) — ✅ REMEDIADO (defense-in-depth)
- **Ubicación:** `src/proxy.ts`, `src/app/api/auth/session`, `src/lib/firebase-token-edge.ts`, sync en `auth-context` / login / logout
- **Problema (histórico):** solo `PrivateRoute` client-side.
- [x] Cookie httpOnly `sf_session` con ID token Firebase (POST `/api/auth/session`).
- [x] Middleware Edge verifica JWT con JWKS de Google (`jose`).
- [x] Rutas públicas: login/register/forgot-password/app-admin/login/api/static/offline.
- [x] Sync en `onIdTokenChanged`, login, register, logout.
- [x] Client `PrivateRoute` se mantiene (UX + offline PWA).
- [x] Prefetch/RSC sin cookie no hard-bloquea (evita race post-login); documento full sí se redirige.
- [ ] (Opcional) Session cookie de larga duración (`createSessionCookie`) en vez de ID token 1h.

### A2. Storage write abierto a cualquier path — ✅ REMEDIADO
- **Ubicación:** `storage.rules`, `src/lib/storage-paths.ts`
- [x] Write canónico en `users/{userId}/**` con `request.auth.uid == userId`.
- [x] Paths legacy con segmento `userId` solo owner.
- [x] Carpetas planas (`missionary-images/**`) write `false` (solo Admin SDK).
- [x] Límite 20 MB e `image/*`.
- [x] Uploads usan `userScopedStoragePath()` (sanitiza category/fileName).

### A3. `barrioOrg` auto-modificable en perfil → escalamiento horizontal — ✅ REMEDIADO
- **Ubicación:** `firestore.rules` (`c_users` update)
- [x] Self-update bloquea `role`, `permission`, `barrioOrg`, `barrio`, `organizacion`.
- [x] Leadership solo puede gestionar peers en el mismo `barrioOrg`.
- [x] Cliente no puede setear/cambiar `isAppAdmin` ni tenant `__system__|__app_admin__`.

### A4. Colecciones sin regla / catch-all permisivo — ✅ REMEDIADO (diseño actual)
- **Ubicación:** `firestore.rules`
- [x] Default: `match /{document=**} { allow read, write: if false; }`.
- [x] Colecciones de negocio con reglas explícitas + `isSameBarrio()`.
- [x] `c_sync_signals` read solo mismo barrio; write false (solo Admin/CF).
- **Nota:** colecciones no listadas en rules quedan deny-by-default (p. ej. legacy `c_nuevos_conversos`).

### A5. Cron abierto si `CRON_SECRET` no está set — ✅ REMEDIADO (código)
- **Ubicación:** `birthday-notifications`, `deceased-members-ordinances`
- [x] Exigir `CRON_SECRET` incondicionalmente; 401 si falta o no coincide.
- [ ] Confirmar en Vercel/prod que la variable está set (operación).
- [ ] Nota: `vercel.json` solo agenda `/api/birthday-notifications`; el de fallecidos debe invocarse con el mismo secreto si se usa.

### A6. Endpoint de IA (chat) pagado sin autenticación — ✅ REMEDIADO
- **Ubicación:** `src/app/api/church-chat/route.ts`, UI `church-chat/page.tsx`
- **Problema (histórico):** sin Bearer; abuso = costo DeepSeek.
- [x] `requireUid` en el route (401 si falta token).
- [x] Cliente siempre envía `Authorization: Bearer` (falla local si no hay sesión).
- [x] Rate limiting (`enforceRateLimit` preset `churchChat`).
- [ ] (Opcional) Cachear respuestas comunes; tope diario por uid en Redis/Upstash.

### A7. Storage read abierto — ✅ MEJORADO (residual aceptable)
- **Ubicación:** `storage.rules`
- **Estado:** Lectura de `image/*` permitida (necesario para `<img>` sin token de Auth). Las URLs de Firebase llevan download token. Write ya no es global.
- [x] Write scopeado por `userId`.
- [ ] (Opcional) URLs firmadas de corta vida y quitar read público de imágenes.

### A8. `c_barrios` / `c_organizaciones` escritura por cualquier auth — ✅ REMEDIADO
- **Ubicación:** `firestore.rules`
- [x] Write solo `isSecretary()`.
- [x] Read público (nombres de referencia para registro) — aceptable.

### A9. SSRF en `fetchImageBuffers` (axios sin allowlist) — ✅ REMEDIADO / N/A
- **Ubicación (histórica):** `functions/src/index.ts`
- **Estado 2026-07-14:** no hay `axios` ni `fetchImageBuffers` en `functions/src`. El riesgo se retiró con los reportes DOCX.
- [x] Código eliminado / no presente en el árbol actual.

### A10. `/api/analyze-image` (Gemini) sin autenticación — ✅ REMEDIADO
- **Ubicación:** `src/app/api/analyze-image/route.ts`, `MissionaryImagesTab.tsx`
- **Problema (histórico):** POST público → abuso de `GEMINI_API_KEY`.
- [x] `requireUid`.
- [x] Rate limit preset `upload`.
- [x] Cliente envía Bearer al analizar.
- [x] Validación Zod de data URL y tamaño máximo.
- [x] Respuestas de error genéricas en fallos de proveedor (sin filtrar detalles internos).

### A11. APIs Admin SDK de miembros sin RBAC (`canWrite`) — ✅ REMEDIADO (mutaciones)
- **Ubicación:** `src/app/api/members/route.ts`, `src/app/api/members/[id]/route.ts`, helpers en `src/lib/api-auth.ts`
- **Problema (histórico):** Admin SDK bypaseaba `canWrite` de Firestore rules.
- [x] POST/PUT/DELETE llaman `requireCanWrite(uid)` tras auth + tenant.
- [x] Helpers compartidos: `getUserAccessProfile`, `requireCanWrite`, `requireLeadership`.
- [ ] GET: política de producto si `user`/`other` deben ver PII completa (hoy: auth + mismo barrio).
- [x] External API es read-only — OK.

### A12. Broadcast FCM sin comprobar liderazgo — ✅ REMEDIADO
- **Ubicación:** `src/app/api/send-fcm-notification/route.ts`
- **Problema (histórico):** cualquier autenticado del barrio podía spamear push + deep links arbitrarios.
- [x] `requireLeadership(uid)` (secretary / president / counselor).
- [x] `sanitizeAppRelativeUrl(url)` — solo paths relativos de la app.
- [x] Scope por `barrioOrg` del llamador.

### A13. Superficie app-admin (impersonate / bootstrap / credentials) — ✅ CONTROLES OK · residual operativo
- **Ubicación:** `src/app/api/app-admin/*`, `src/lib/app-admin.ts`
- [x] `requireAppAdmin` exige `isAppAdmin === true` en Firestore (no solo email).
- [x] Impersonate: no permite impersonar otro app-admin; escribe auditoría; rate limit `auth`.
- [x] `update-credentials` / `update-self`: Zod, no mutar otro app-admin, auditoría.
- [x] Bootstrap: fail closed sin `APP_ADMIN_BOOTSTRAP_SECRET` (≥8); rate limit.
- [x] Re-bootstrap **no** rota password salvo `APP_ADMIN_BOOTSTRAP_ALLOW_RESET=true`.
- [ ] Operación: vaciar `APP_ADMIN_BOOTSTRAP_SECRET` tras el alta o rotarlo; nunca dejar ALLOW_RESET en prod permanente.

---

## 🟡 MEDIOS

### M1. Credenciales vivas en el working tree — ⬜ OPERACIONAL
- **Ubicación:** `.env.local`, `.env.production`, service account JSON (gitignoreados)
- [ ] Rotar service-account y API keys si hubo exposición.
- [ ] Preferir Secret Manager / env de Vercel-Firebase.
- [x] `.gitignore` excluye `.env`, `.env.*`, `.env.local`, `.env.production`, `*-firebase-adminsdk-*.json`.
- [x] `git ls-files` no trackea secrets (solo `.env.example` y `next-env.d.ts`).

### M2. `typescript.ignoreBuildErrors: true` — ✅ REMEDIADO
- **Ubicación:** `next.config.ts`
- [x] `ignoreBuildErrors: false`.
- [x] Errores TS previos corregidos (`Member.barrioOrg`, Calendar `initialFocus`).
- [x] `pnpm typecheck` en CI.

### M3. Sin CI / Dependabot / CodeQL — ✅ REMEDIADO (baseline)
- **Ubicación:** `.github/workflows/ci.yml`, `.github/dependabot.yml`
- [x] CI: install + typecheck + lint + test:roles.
- [x] Dependabot semanal (npm + github-actions).
- [ ] (Opcional) CodeQL o `pnpm audit` en CI.
- [ ] (Opcional) Tests de `firestore.rules` con emulador.

### M4. Logging / error responses verbosos — ✅ MEJORADO
- **Ubicación:** members GET/PUT/DELETE, send-fcm, analyze-image
- [x] Respuestas 500 genéricas sin `details`/`stack` al cliente.
- [x] 401/403 siguen con mensaje de auth controlado.
- [x] Logger silencia `debug` en prod.
- [ ] (Opcional) request-id correlacionado en logs.

### M5. CORS con orígenes de desarrollo — ✅ REMEDIADO (config; apply bucket pendiente)
- **Ubicación:** `cors.json` (prod), `cors.dev.json` (local)
- [x] `cors.json` sin localhost — solo hosts Firebase prod/dev del proyecto.
- [x] `cors.dev.json` conserva localhost para desarrollo.
- [ ] Aplicar al bucket: `gsutil cors set cors.json gs://$BUCKET` (operación).
- [ ] Añadir dominio Vercel custom si se usa.

### M6. Enumeración de correos en forgot-password — ✅ REMEDIADO
- **Ubicación:** `src/app/api/auth/forgot-password/route.ts`, UI forgot-password
- [x] API siempre responde `{ ok: true }` (salvo email inválido / rate limit).
- [x] UI muestra el mismo éxito aunque el envío no revele existencia.
- [x] Rate limit `auth` mantenido.
- [ ] (Opcional) CAPTCHA.

### M7. Rate limit solo en memoria (por instancia) — ⬜ RESIDUAL DOCUMENTADO
- **Ubicación:** `src/lib/rate-limit.ts`
- **Estado:** documentado en código; en Vercel multi-instancia el techo no es global.
- [ ] Si el abuso crece: Upstash/Redis (CSP ya permite `*.upstash.io`).
- [x] Presets: `api`, `churchChat`, `auth`, `upload`; identidad uid > IP.

### M8. `/api/auth/registration-capacity` público — ✅ MITIGADO
- **Ubicación:** `src/app/api/auth/registration-capacity/route.ts`
- **Problema residual:** sin auth; revela cupos por barrio (no PII de personas).
- [x] Rate limit estricto: 10/min por IP (prefix dedicado).
- [ ] (Opcional) CAPTCHA o token de registro.

### M9. Respuestas de error con fugas de implementación — ⬜ REVISAR
- **Ejemplos:** FCM `details: error.message`; members GET con `code`/`details`; analyze-image reenvía `error.message`.
- [ ] Homogeneizar envelope de error en prod (mensaje genérico + request id opcional).

### M10. Migración Admin de docs sin `barrioOrg` — ✅ CONTROLES OK
- **Ubicación:** `src/app/api/admin/migrate-barrio-org/route.ts`
- [x] `requireUidAndBarrioOrg` + `hasLeadershipPrivileges`.
- [x] `targetBarrioOrg` debe ser exactamente el del llamador.
- [x] Rate limit; límite por colección.
- **Residual:** scan con Admin SDK de docs sin scope es poderoso; mantener solo liderazgo.

---

## 🟢 BAJOS

### B1. `dangerouslySetInnerHTML` en chart — ✅ N/A (componente eliminado)
- **Ubicación (histórica):** `src/components/ui/chart.tsx`
- **Estado:** el archivo ya no existe en el árbol. `recharts` sigue como dependencia pero sin ese sink documentado.

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
- [x] `getEligibleUsers` fail closed sin `scope`.
- [x] Helpers cliente exigen `barrioOrg`.
- [x] Campanita filtra por `barrioOrg` del usuario.
- [x] Create de `c_notifications` exige `barrioOrg` en rules.
- [x] Tool de migración Admin para sellar docs legacy.

### B5. XSS almacenado vía `dangerouslySetInnerHTML` + nombres de usuario — ✅ REMEDIADO
- **Ubicación:** missionary-work (investigators + FutureMembersTab)
- **Problema (histórico):** i18n con `<strong>{name}</strong>` vía `dangerouslySetInnerHTML`.
- [x] Render con texto React (`{t(..., { name })}`) — el nombre se escapa automáticamente.
- [x] Locales es/en sin tags HTML en esas cadenas.
- [ ] (Opcional) Validar/sanitizar nombres al guardar (longitud + charset).

### B6. CSP permisiva en imágenes y scripts — ✅ MEJORADO (residual scripts)
- **Ubicación:** `next.config.ts` headers
- [x] HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, CSP base presentes.
- [x] `img-src` sin `http:` (solo `https:` + `data:` + `blob:` + `'self'`).
- [ ] `script-src` incluye `'unsafe-inline'` y `'unsafe-eval'` (Next/Firebase SW) — deuda conocida.
- [ ] (Opcional) `frame-ancestors 'none'` en CSP.

### B7. `/api/icon` proxy de icono configurado — ✅ BAJO RIESGO
- **Ubicación:** `src/app/api/icon/route.ts`
- **Estado:** fetch de `getAppIcon()` (env/config), no input de usuario → no es SSRF explotable por cliente. Rate limit presente.
- [x] Sin parámetro de URL controlado por el cliente.

### B8. JSON-LD con `dangerouslySetInnerHTML` — ✅ ACEPTABLE
- **Ubicación:** `src/components/seo/json-ld.tsx`
- **Estado:** datos de configuración/SEO de la app, no input de usuario de barrio.

---

## ✅ Controles verificados (baseline multi-tenant + app-admin)

### Auth API
- [x] `requireAuth` / `requireUid` / `requireUidAndBarrioOrg` / `buildBarrioOrgFromUserData` en `src/lib/api-auth.ts`
- [x] Nunca default a un barrio de producción para perfiles incompletos
- [x] `/api/members`, `/api/members/[id]`, `/api/external/*`, push (envío/diagnóstico), suggestions, storage upload, migrate-barrio-org
- [x] App-admin: `requireAppAdmin` en me/users/impersonate/update-*; bootstrap por secreto de entorno
- [x] **RBAC mutaciones Admin:** `requireCanWrite` (members), `requireLeadership` (FCM, migrate)
- [x] **Auth en IA:** church-chat + analyze-image con `requireUid`
- [x] Helpers: `requireCanWrite`, `requireLeadership`, `sanitizeAppRelativeUrl` en `api-auth.ts`

### Firestore
- [x] `isSameBarrio()` en colecciones de datos
- [x] `c_users`: peers solo mismo barrio; self-update sin tocar tenant/roles; sin auto `isAppAdmin`
- [x] `c_notifications`: read solo owner
- [x] `c_admin_audit`: leadership mismo barrio; update/delete false
- [x] `c_barrios` / `c_organizaciones`: write secretary; read público
- [x] Default deny
- [x] **C6:** `canUpdateInBarrio` + anotaciones con `barrioOrg` inmutable (desplegado en quorumflow-dlqh0)

### Storage
- [x] Write owner-scoped (`users/{userId}/…` + legacy con userId)
- [x] Helper `userScopedStoragePath` con sanitización de path

### Cloud Functions / push
- [x] Notificaciones CF fail closed sin `barrioOrg` del documento
- [x] Push server sin `barrioOrg` → no broadcast global
- [x] `requestDataSyncSignal` scoped al llamador
- [x] Sin `fetchImageBuffers`/axios (A9 cerrado)

### Headers / edge
- [x] Security headers en `next.config.ts` (HSTS, CSP, XFO, etc.)
- [ ] Sin middleware de sesión (A1)
- [ ] CORS prod limpio (M5)

### Repo / config
- [x] Sin `eval`/`exec`/`child_process`/`new Function` en `src/` (scripts de build sí usan child_process — fuera de runtime web)
- [x] `.gitignore` de secrets; `firebaseConfig` solo `NEXT_PUBLIC_*`
- [x] `SECURITY.md`, `docs/SEGURIDAD.md` y este audit presentes
- [ ] CI + typecheck obligatorio (M2, M3)
- [x] Script `typecheck` y `test:roles` disponibles localmente

---

## Matriz rápida de API routes (2026-07-14)

| Ruta | Auth | Tenant | Rate limit | Notas |
|------|------|--------|------------|--------|
| `/api/members` GET | Bearer + barrio | Sí | api | Lectura tenant |
| `/api/members` POST | Bearer + barrio + **canWrite** | Sí | api | OK |
| `/api/members/[id]` PUT/DELETE | Bearer + barrio + **canWrite** | Sí | api | OK |
| `/api/external/*` | Bearer + barrio | Sí | api | Read-only |
| `/api/send-fcm-notification` | Bearer + barrio + **liderazgo** | Sí | api | URL relativa sanitizada |
| `/api/send-push-notification` | Bearer + barrio | Sí | api | Solo cuenta preferencias |
| `/api/push/diagnostics` | Bearer + liderazgo | Sí | api | OK |
| `/api/suggestions`, `service-suggestions` | Bearer + barrio | Sí | api | OK |
| `/api/storage/upload` | Bearer uid | path owner | upload | OK |
| `/api/admin/migrate-barrio-org` | Bearer + liderazgo | target=caller | api | OK |
| `/api/app-admin/*` (salvo bootstrap) | Bearer + isAppAdmin | N/A platform | api/auth | OK |
| `/api/app-admin/bootstrap` | Secreto env | N/A | auth | OK fail closed |
| `/api/birthday-notifications` | CRON_SECRET | multi-tenant server | api | OK |
| `/api/deceased-members-ordinances` | CRON_SECRET | multi-tenant server | api | OK |
| `/api/church-chat` | Bearer (`requireUid`) | N/A | churchChat | OK |
| `/api/analyze-image` | Bearer (`requireUid`) | N/A | upload | OK |
| `/api/download-qr` | Público + **allowlist SSRF** | N/A | api | OK |
| `/api/auth/forgot-password` | Público | N/A | auth | **M6** enumeración |
| `/api/auth/registration-capacity` | Público | por query | auth | **M8** |
| `/api/icon` | Público | N/A | api | URL fija de config |

---

## Orden de remediación restante (recomendado)

1. **Deploy app (Vercel)** — publicar middleware + APIs + auth session en el host Next.
2. **Aplicar CORS prod al bucket** — `gsutil cors set cors.json gs://<STORAGE_BUCKET>`.
3. **M1** — rotar secrets locales si aplica.
4. **B6 / M7–M8** — CSP residual, rate limit global, capacity público.
5. (Opcional) Session cookie de larga duración; tests de rules; CodeQL.

---

## Despliegue de reglas y functions

Tras cambios en aislamiento multi-tenant, desplegar:

```bash
firebase deploy --only firestore:rules,storage
firebase deploy --only functions
# + deploy de la app (Vercel/hosting)
```

Migrar documentos legacy sin `barrioOrg` desde **Admin → Migrar** (solo sella con el `barrioOrg` del usuario autenticado).

Variables críticas en prod: `CRON_SECRET`, `FIREBASE_SERVICE_ACCOUNT_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `APP_ADMIN_BOOTSTRAP_SECRET` (vacío tras bootstrap si se desea deshabilitar), `APP_ADMIN_EMAIL` / password rotados.

---

## Historial de revisiones

| Fecha | Cambio |
|-------|--------|
| 2026-07-15 | **C7:** migrate solo docs atribuibles; bootstrap sin reset password; notif URL safety; FCM count leadership; capacity rate 10/min; CSP sin img http. |
| 2026-07-15 | **Urgentes:** A1 middleware+session cookie; M2 typecheck en build; M3 CI+Dependabot; M4 errores genéricos; M5 cors prod/dev; M6 anti-enumeración forgot-password. |
| 2026-07-14 | **Oleada remediación código:** C2 (safe-remote-url), A6/A10 (requireUid IA), A11 (requireCanWrite members), A12 (liderazgo + URL FCM), B5 (XSS i18n). Helpers en `api-auth.ts`. |
| 2026-07-14 | **C6 desplegado** en `quorumflow-dlqh0` (`firestore:rules`). |
| 2026-07-14 | **C6 remedido en código:** `barrioOrgUnchanged()` + `canUpdateInBarrio` fail closed; anotaciones inmutables; audit actualizado. |
| 2026-07-14 | **Auditoría profunda:** nuevo **C6** (`canUpdateInBarrio` OR permite robo de docs); **A10** analyze-image sin auth; **A11** mutaciones members sin RBAC; **A12** FCM sin liderazgo; **A13** app-admin verificado; **M6–M10**, **B5–B8**; A9 y B1 cerrados; matriz de API routes; orden de remediación actualizado. |
| 2026-07-14 | Re-auditoría previa: C1/C3/C4/C5, A2–A5/A8, B2–B4 marcados remediados; resumen multi-tenant. |
| (previo) | Auditoría inicial con hallazgos C1–C5 y A1–A9 abiertos. |
