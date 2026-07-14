# Políticas de Seguridad

Documento de políticas operativas. Para el checklist técnico de hallazgos y remediación, ver [`SECURITY_AUDIT.md`](../SECURITY_AUDIT.md) en la raíz del repo.

**Última actualización:** 2026-07-14

## Autenticación y Autorización

### Firebase Authentication
- Autenticación con email/contraseña
- Firebase Admin SDK para verificación server-side de tokens en API routes (`requireAuth` / `requireUid` / `requireUidAndBarrioOrg` en `src/lib/api-auth.ts`)
- Sin proveedores OAuth externos

### Roles y Permisos

| Rol | Permiso | Acceso |
|---|---|---|
| `secretary` | Todo | Control total: admin, ajustes, gestión de roles, reportes |
| `president` | Todo | Módulos operativos + panel de admin |
| `counselor` | Todo | Seguimiento de familias y asignaciones |
| `other` | Lectura | Solo lectura de datos |
| `user` | Lectura | Bloqueado hasta asignación de rol de liderazgo |

- **Visibilidad de páginas**: el menú lateral se puede configurar por usuario desde el panel de admin.
- Las cuentas con rol `user` ven la página de acceso restringido hasta que un líder les asigne un rol.
- Un usuario **no** puede auto-cambiar `role`, `permission`, `barrio`, `organizacion` ni `barrioOrg` (reglas Firestore).

## Aislamiento multi-tenant (`barrioOrg`)

Cada usuario pertenece a un tenant:

```text
barrioOrg = "{barrio}|{organización}"
# ejemplo: "Libertad|Quórum de Élderes"
```

### Capas de aislamiento

| Capa | Comportamiento |
|------|----------------|
| **Firestore rules** | Lectura/escritura de datos de negocio solo si `doc.barrioOrg == user.barrioOrg` (`isSameBarrio`) |
| **API routes (Admin SDK)** | Resuelven `barrioOrg` desde `c_users/{uid}`; **ignoran** el `barrioOrg` del cliente |
| **Cliente / UI** | Queries con `where('barrioOrg', '==', barrioOrg)`; helpers fallan cerrados si falta el scope |
| **Cloud Functions** | Reportes y notificaciones filtrados por `barrioOrg` del usuario o del documento; sin scope → no notificar |
| **Push / FCM** | Broadcast solo dentro del `barrioOrg` del llamador |
| **Storage** | Escritura en `users/{uid}/…` (owner); lectura de imágenes vía token de descarga / content-type |
| **Notificaciones in-app** | Lectura solo del dueño (`userId`); create exige `barrioOrg` del mismo tenant |

### Fail closed (principios)

- Perfil sin barrio/organización → **403**, no se asume un barrio por defecto.
- Documento sin `barrioOrg` → no es legible por reglas de cliente; no genera notificaciones multi-usuario.
- Listados Admin (`fetchMembers`, etc.) **exigen** `barrioOrg`; nunca “todos los barrios”.
- Jobs cron requieren `CRON_SECRET`; si no está configurado, se rechaza la petición.

### Sellado automático al crear datos

Al crear miembros, notas, actividades, servicios, ministración, etc., el cliente/API **estampa** `barrioOrg` del usuario autenticado (`useAuth().barrioOrg` o `requireUidAndBarrioOrg` en servidor). Helper: `src/lib/tenant-scope.ts` → `requireBarrioOrg` / `withTenantScope`.

Las reglas Firestore (`canCreateInBarrio`) solo permiten create si `request.resource.data.barrioOrg` coincide con el del usuario: un cliente **no** puede guardar datos de otro barrio aunque manipule el payload.

El registro de usuario también guarda `barrio`, `organizacion` y `barrioOrg` en `c_users`.

### Migración de datos legacy

Documentos antiguos sin `barrioOrg` se sellan desde **Admin → Migrar** usando  
`POST /api/admin/migrate-barrio-org` (liderazgo, Admin SDK). Solo puede asignarse el **mismo** `barrioOrg` del usuario autenticado (nunca otro tenant).

## Protección de Datos

### En tránsito
- TLS para comunicaciones
- Firebase Auth con tokens firmados
- CORS configurado para orígenes autorizados

### En reposo
- Firestore y Storage con cifrado de Google Cloud / Firebase
- Claves de API y service accounts en variables de entorno (nunca en el bundle cliente)

### PII
- Miembros, conversos, salud y similar solo visibles dentro del `barrioOrg`
- Endpoints cron no devuelven listados de nombres cross-tenant en la respuesta HTTP
- La campanita de notificaciones no muestra ítems sin `barrioOrg` o de otro tenant

## Prácticas seguras

### Desarrollo
- Variables de entorno para secretos
- Validación de entrada con Zod en routes relevantes
- Rate limiting en APIs (`enforceRateLimit`)
- Sin hardcoding de secretos ni URLs de proyecto en lógica de negocio

### Voz y multimedia
- Reconocimiento de voz en el navegador (Web Speech API)
- Sin almacenamiento de audio original — solo texto transcrito
- Permiso explícito del navegador para el micrófono

### Notificaciones push
- Tokens FCM en `c_push_subscriptions` (por usuario)
- Preferencias y envíos respetan `barrioOrg`
- Tokens inválidos se invalidan al fallar FCM

### Storage de imágenes
- Path canónico: `users/{userId}/{categoría}/{archivo}`
- Helper: `src/lib/storage-paths.ts` → `userScopedStoragePath`
- Upload server: `/api/storage/upload` (Bearer + path bajo el uid del uploader)

## Respuesta a incidentes

### Reporte de vulnerabilidades
1. GitHub Security Advisories (ver también `SECURITY.md`)
2. Respuesta objetivo en 48 horas
3. Divulgación responsable

### Proceso de mitigación
1. Contención  
2. Análisis de impacto  
3. Corrección  
4. Pruebas  
5. Despliegue (incl. `firestore.rules` / `storage.rules` / functions si aplica)  
6. Comunicación a afectados si corresponde  

## Auditoría
- Logs de auditoría en Firestore (`c_admin_audit`) para acciones de liderazgo
- Registro de cambios de rol y permisos
- Checklist vivo: [`SECURITY_AUDIT.md`](../SECURITY_AUDIT.md)
- Revisiones de acceso periódicas por barrio/organización

## Costes al escalar barrios

- **UI/APIs**: lecturas filtradas por el `barrioOrg` del usuario (no leen otros tenants).
- **Triggers CF (actividad, servicio, etc.)**: cargan solo usuarios del barrio del documento (`getUsersForDocBarrioOrg`), no `c_users` completo.
- **Crons CF diarios/semanales**: una pasada de usuarios por ejecución (con field mask) + datos por barrios activos.
- **Cron Vercel cumpleaños / fallecidos**: barrios activos vía `c_users.select('barrioOrg')` + queries por `barrioOrg in […]` (sin `.get()` global de miembros).
- **Reportes**: coste por generación, scoped al tenant del llamador.

## Despliegue de controles de seguridad

```bash
firebase deploy --only firestore:rules,storage
firebase deploy --only functions
```

Tras desplegar rules nuevas, verificar que el entorno tiene `CRON_SECRET` y no hay documentos operativos sin `barrioOrg` (herramienta de migración en admin).