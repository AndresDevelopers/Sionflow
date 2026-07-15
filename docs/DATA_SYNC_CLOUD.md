# Sincronización automática vía Cloud Functions

## Flujo

```
Cambio en Firestore (miembros, notas, ministración, …)
        │
        ▼
Cloud Function onWrite (syncOn*Write)
        │
        ├─► Escribe/actualiza  c_sync_signals/{barrioOrgCodificado}
        │         version, lastCollection, lastDocId, …
        │
        └─► FCM data-only (silencioso, throttled 15s)
                  type: data-sync
        │
        ▼
App (cliente)
  • DataSyncListener: onSnapshot del signal → requestRefresh({ silent: true })
  • PushForegroundListener / SW: mensaje DATA_SYNC → mismo refresh
  • Botón header Actualizar = fallback manual (con toast)
```

## Colecciones que publican señal

- `c_miembros`, `c_anotaciones`, `c_ministracion`, `c_ministracion_distritos`
- `c_actividades`, `c_servicios`
- `c_obra_misional_*`, `c_observaciones_salud`, `c_cumpleanos`, `c_bautismos`
- `c_fs_*`, `c_conversos`, `c_futuros_miembros`, `c_users`

## Qué NO publica señal (pipeline de notificaciones)

- `c_notifications` y `c_push_subscriptions` son propiedad del **notification-dispatcher** CF.
  Esos writes **nunca** activan `syncOn*Write`: la CF de notificaciones ya lleva el payload
  (FCM `type: user-notification`) y escribe el documento in-app.
- Updates de solo bookkeeping de notificaciones en colecciones de dominio
  (p. ej. `urgentNotifiedAt`, flags derivados de push) se omiten del data-sync.
  Cambios de contenido real (título, fechas, familias, …) sí publican señal.

## Deploy

```bash
cd functions
pnpm install
# compilar si aplica
firebase deploy --only functions:syncOnMembersWrite,functions:syncOnAnnotationsWrite,...
# o todas:
firebase deploy --only functions
firebase deploy --only firestore:rules
```

## Seguridad

- `c_sync_signals`: solo lectura si `barrioOrg` del doc == barrio del usuario.
- Escritura solo Admin SDK (Cloud Functions). `allow write: if false` en rules.

## Fallback

Si la CF o el listener fallan, el usuario usa el icono de actualizar del header (forza red + merge de cache).
