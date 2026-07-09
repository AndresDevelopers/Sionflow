# Auditoría de Seguridad — Quroumflow

> Documento vivo con checklist para remediación asistida por IA.
> Marca `[x]` los ítems conforme se resuelvan. Cada hallazgo incluye los pasos exactos de remediación como sub-checkboxes.

**Leyenda de severidad:** 🔴 CRÍTICO · 🟠 ALTO · 🟡 MEDIO · 🟢 BAJO

**Alcance:** `src/` (auth, API routes, server actions, UI), `functions/`, `firestore.rules`, `storage.rules`, configs de despliegue y repo hygiene.

**Resumen ejecutivo:** El sistema es una app multi-tenant (por `barrioOrg`) sobre Next.js + Firebase. El mayor riesgo es la **ausencia de autorización server-side**: casi todos los endpoints Admin-SDK y varias Cloud Functions callable solo verifican que el usuario esté "logueado", sin comprobar su rol/ward, exfiltrando PII de todos los congregados. Además hay 2 credenciales vivas en el working tree y reglas de Storage/Firestore demasiado permisivas.

---

## 🔴 CRÍTICOS

### C1. PII completa de todos los miembros sin autenticación
- **Ubicación:** `src/app/api/members/route.ts:126`
- **Problema:** `GET` no tiene auth y usa `firestoreAdmin` (bypasea reglas). Si se omite `barrioOrg`, `fetchMembers` devuelve todos los miembros de todas las congregaciones (nombres, teléfonos, emails, direcciones, fotos, observaciones de salud, ordenanzas).
- [ ] Añadir verificación de token (`authAdmin.verifyIdToken`) en el handler `GET`.
- [ ] Scopear la consulta por `barrioOrg` del usuario autenticado; nunca devolver PII cross-ward.
- [ ] Rechazar la petición si `barrioOrg` del usuario es nulo/inválido.

### C2. SSRF en `/api/download-qr`
- **Ubicación:** `src/app/api/download-qr/route.ts:3-11`
- **Problema:** Hace fetch de una URL arbitraria provista por el cliente desde el servidor, sin allowlist de host/esquema → puede apuntar a metadata de GCP (`169.254.169.254`) o redes internas.
- [ ] Restringir esquema a `https:` únicamente.
- [ ] Allowlist de hosts esperados (host del QR de donaciones).
- [ ] Rechazar rangos IP privados/metadata (`10.x`, `172.16.x`, `192.168.x`, `169.254.x`).
- [ ] Requerir auth o token firmado para el endpoint.

### C3. Endpoint de ordenanzas de fallecidos sin autenticación
- **Ubicación:** `src/app/api/deceased-members-ordinances/route.ts:45,148`
- **Problema:** `GET`/`POST` sin auth; expone nombres de fallecidos + ordenanzas faltantes y dispara notificaciones.
- [ ] Añadir `requireAuth()` / `requireLeadership()` en ambos handlers.
- [ ] Scopear por `barrioOrg` del llamador.
- [ ] Validar body con Zod antes de procesar.

### C4. Broadcast FCM a todos los usuarios sin autenticación
- **Ubicación:** `src/app/api/send-fcm-notification/route.ts:52`
- **Problema:** Sin auth, cualquiera puede enviar push a todos los usuarios (`pushNotificationsEnabled === true`) → spam/costo.
- [ ] Añadir `requireLeadership()` (verificar `permission == 'all'` o rol).
- [ ] Limitar destinatarios al `barrioOrg` del llamador salvo rol global explícito.
- [ ] Añadir rate limiting por origen.

### C5. Reportes callable exponen datos de todos los tenants
- **Ubicación:** `functions/src/index.ts:625-633` (`generateCompleteReport`), `functions/src/index.ts:963-971` (`generateReport`)
- **Problema:** Solo verifican `if (!context.auth)`; luego leen TODAS las colecciones de TODOS los `barrioOrg` con Admin SDK. `data.organizacion` es solo etiqueta, nunca filtro.
- [ ] Tras `context.auth`, cargar `c_users` del llamador (`barrioOrg`, `permission`, `role`).
- [ ] Scopear cada query Firestore con `.where("barrioOrg", "==", callerBarrioOrg)`.
- [ ] Rechazar si el llamador no tiene `permission == 'all'` o rol secretario.

---

## 🟠 ALTOS

### A1. Sin protección server-side (solo guardas client-side)
- **Ubicación:** `src/app/(main)/layout.tsx:14-132`, `src/app/(main)/admin/layout.tsx:22-113` — no existe `middleware.ts`
- **Problema:** La "auth" es solo client-side; cualquier API route/server action es alcanzable directamente por un cliente no navegador.
- [ ] Crear `src/middleware.ts` que verifique session cookie / ID token en el edge.
- [ ] Proteger `/api/*` y `(main)/*` a nivel edge; redirigir/no autorizar según corresponda.
- [ ] Mantener las guardas client-side como UX, no como control de seguridad.

### A2. Storage write abierto a cualquier usuario autenticado
- **Ubicación:** `storage.rules:20-26`
- **Problema:** Cualquier auth puede escribir/sobrescribir/borrar en CUALQUIER path (no hay scope a `userId`/`barrioOrg`). `request.resource == null` permite borrado irrestricto.
- [ ] Restringir write a `images/{userId}/**` validando `request.auth.uid == userId`.
- [ ] Eliminar la rama `request.resource == null` que permite delete sin restricción.
- [ ] Mantener límite de tamaño/tipo.

### A3. `barrioOrg` auto-modificable → escalamiento horizontal
- **Ubicación:** `firestore.rules:199-206` (`c_users` update)
- **Problema:** Solo bloquea auto-edición de `role`/`permission`, pero un usuario puede cambiar su propio `barrioOrg` y leer/escribir datos de otro tenant vía `isSameBarrio()`.
- [ ] Añadir `barrioOrg` y `organizacion` a `changedKeys().hasAny([...])` bloqueados en self-update.
- [ ] Permitir cambio de `barrioOrg` solo vía `isSecretary()`.

### A4. `c_nuevos_conversos` sin regla → lectura cross-barrio
- **Ubicación:** `firestore.rules:224-226` (default `match /{document=**} { allow read: if signedIn(); }`)
- **Problema:** La colección cae en la regla catch-all y cualquier auth la lee sin scope de ward.
- [ ] Añadir `match /c_nuevos_conversos/{document}` con `isSameBarrio()` para read/write.
- [ ] Auditar TODAS las colecciones usadas por la app y añadir reglas explícitas.

### A5. Cron abierto si `CRON_SECRET` no está set
- **Ubicación:** `src/app/api/birthday-notifications/route.ts:11-14`
- **Problema:** Auth solo se aplica `if (cronSecret && ...)`. Si `CRON_SECRET` no está definido en prod, el endpoint queda abierto.
- [ ] Exigir `CRON_SECRET` incondicionalmente; fallar (500/401) si no está configurado.
- [ ] Validar el header `Authorization: Bearer <CRON_SECRET>` en cada request.
- [ ] Confirmar que está set en Vercel y en todos los entornos desplegados.

### A6. Endpoint de IA pagado sin autenticación
- **Ubicación:** `src/app/api/church-chat/route.ts:30`
- **Problema:** Sin auth, cualquiera consume la API de DeepSeek (costo/DoS). (Bien: usa Zod).
- [ ] Añadir `requireAuth()`.
- [ ] Añadir rate limiting por usuario/IP.
- [ ] (Opcional) Cachear respuestas comunes.

### A7. Storage read abierto a cualquier usuario autenticado
- **Ubicación:** `storage.rules:13`
- **Problema:** `allow read: if request.auth != null` permite leer fotos/perfiles de otros usuarios y wards.
- [ ] Scopear read por `barrioOrg`/path cuando sea posible.
- [ ] Al menos restringir a `images/{userId}/**` o al `barrioOrg` del usuario.

### A8. `c_barrios` / `c_organizaciones` escritura por cualquier auth
- **Ubicación:** `firestore.rules:212-220`
- **Problema:** `allow write: if request.auth != null` permite a cualquier logueado crear/borrar estas claves de scoping multi-tenant.
- [ ] Restringir write a `isSecretary()` (o rol admin).
- [ ] Mantener `read: if true` para datos de referencia (aceptable).

### A9. SSRF en `fetchImageBuffers` (axios sin allowlist)
- **Ubicación:** `functions/src/index.ts:377-423` (`axios.get` en `:405`)
- **Problema:** Las URLs de imagen vienen de campos editables por usuario con `permission == 'all'`; se hace `axios.get` desde el runtime de Cloud Functions sin allowlist de dominio/IP.
- [ ] Allowlist de dominios (hosts de Storage de Firebase / CDN conocidos).
- [ ] Bloquear rangos IP privados/metadata antes de `axios.get`.
- [ ] Validar que la URL resuelva a host permitido (no solo string match).

---

## 🟡 MEDIOS

### M1. Credenciales vivas en el working tree
- **Ubicación:** `.env.local`, `quorumflow-dlqh0-d46b66e83c09.json` (raíz, gitignored pero en disco)
- **Problema:** Clave de service-account Firebase y `DEEPSEEK_API_KEY` presentes en el repo. Riesgo si se clona/sincroniza/force-add.
- [ ] Rotar inmediatamente la clave de service-account Firebase y la API key de DeepSeek (asumir exposición).
- [ ] Mover secrets a Secret Manager / env de Vercel-Firebase; nunca en el working tree.
- [ ] Eliminar ambos archivos del disco tras rotar.
- [ ] Verificar que no se incluyan en el bundle de build/cliente.

### M2. `typescript.ignoreBuildErrors: true`
- **Ubicación:** `next.config.ts:15-17`
- **Problema:** Desactiva type-checking en build, permitiendo código type-unsafe (potencialmente inseguro) en producción.
- [ ] Quitar `ignoreBuildErrors`.
- [ ] Añadir `tsc --noEmit` en CI antes de build.

### M3. Sin CI / Dependabot / CodeQL
- **Ubicación:** `.github/` (solo templates; no hay `workflows/`)
- **Problema:** Cero automatización de seguridad (lint, typecheck, tests, SCA, SAST).
- [ ] Crear `.github/workflows/ci.yml` con install + lint + typecheck + test en PRs.
- [ ] Añadir Dependabot (`.github/dependabot.yml`) para deps y GH Actions.
- [ ] (Opcional) Añadir CodeQL workflow.

### M4. Logging verboso de request bodies
- **Ubicación:** `src/app/api/members/[id]/route.ts:64-70`
- **Problema:** El `PUT` loguea el body completo (PII) a consola.
- [ ] Eliminar log del body completo; loguear solo IDs/campos no sensibles.
- [ ] Usar nivel debug condicional a entorno no-prod.

### M5. CORS con orígenes de desarrollo
- **Ubicación:** `cors.json:4-5`
- **Problema:** Incluye `localhost:3000/9002` y método `DELETE`.
- [ ] Quitar orígenes localhost del bucket de producción.
- [ ] Restringir métodos a los necesarios (sin `DELETE` si no se usa).

---

## 🟢 BAJOS

### B1. `dangerouslySetInnerHTML` en componente de chart
- **Ubicación:** `src/components/ui/chart.tsx:81`
- **Problema:** Inyecta `<style>` con `id` de `React.useId()` y colores estáticos. Sin datos de usuario → riesgo actual BAJO, pero es un patrón a vigilar.
- [ ] Mantener el valor interpolado siempre no controlado por usuario.
- [ ] Añadir comentario de por qué es seguro para futuros mantenedores.

### B2. Endpoints de sugerencias IA sin auth (costo)
- **Ubicación:** `src/app/api/suggestions/route.ts:33`, `src/app/api/service-suggestions/route.ts:63`
- **Problema:** Sin auth, consumen IA (cached/read-only, bajo riesgo).
- [ ] Añadir `requireAuth()`.
- [ ] Añadir rate limiting.

### B3. `c_push_subscriptions` requiere `canWrite()` para escribir
- **Ubicación:** `firestore.rules:181-183`
- **Problema:** Miembros normales no pueden registrar su token push (safe pero probablemente rompe notificaciones para no-admins). Confirmar intención.
- [ ] Revisar si el write debe permitir `request.resource.data.userId == request.auth.uid` sin `canWrite()`.
- [ ] Si es intencional, documentarlo.

### B4. Usuarios legacy con `barrioOrg == null` reciben notificaciones cross-org
- **Ubicación:** `functions/src/index.ts:1716-1720` (`getEligibleUsers`)
- **Problema:** Usuarios sin `barrioOrg` no se saltan, recibiendo notificaciones de todos los barrios.
- [ ] Tratar `barrioOrg == null` como "sin ward" y excluirlos de notificaciones dirigidas.
- [ ] O asignar un `barrioOrg` por defecto explícito.

---

## ✅ Controles ya correctos (verificados)

- [x] `c_admin_audit` bloqueado a `isSecretary()` (read/create), update/delete `false` — `firestore.rules:188-192`
- [x] `c_users` bloquea auto-edición de `role`/`permission` — `firestore.rules:204`
- [x] `c_anotaciones`/`c_fs_anotaciones` scopean a owner/secretary e `userId` inmutable — `firestore.rules:52-64,116-128`
- [x] `c_push_subscriptions` read scopeado al owner — `firestore.rules:177-180`
- [x] Rutas `/api/external/*` verifican token y scopean por `barrioOrg` del llamador
- [x] `/api/push/diagnostics` verifica token + `hasLeadershipPrivileges` + Zod
- [x] `church-chat`, `push/diagnostics`, y AI flows usan Zod
- [x] Sin `eval`/`exec`/`child_process`/`new Function` en `src/`
- [x] Cloud Functions callable usan guard `context.auth` (functions apropiadamente protegidas en su superficie)
- [x] `.gitignore` excluye `.env.local` y `*-firebase-adminsdk-*.json`; no hay secrets commiteados
- [x] `firebaseConfig.ts` solo usa `NEXT_PUBLIC_*` (seguro para browser)
- [x] `SECURITY.md` y `.github/SECURITY.md` presentes; docs sin instrucciones inseguras

---

## Orden de remediación recomendado

1. **C5, C1, C3, C4** — autorización server-side y scoping por `barrioOrg` (CRÍTICOS de exfiltración).
2. **C2, A9** — cerrar SSRF (allowlist host/IP).
3. **M1** — rotar y sacar credenciales del working tree.
4. **A3, A4, A8, A7, A2** — endurecer reglas Firestore/Storage (aislamiento multi-tenant).
5. **A1, A5, A6** — middleware edge + auth incondicional en cron/IA.
6. **M2, M3** — type-check en build + CI/Dependabot/CodeQL.
7. **Resto (MEDIOS/BAJOS)** — logging, CORS, ítems menores.
