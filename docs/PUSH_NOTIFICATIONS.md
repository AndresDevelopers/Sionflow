# Guía de Notificaciones

## Sistema de Notificaciones Programadas y Push

El sistema de notificaciones de QuorumFlow usa Firebase Cloud Messaging (FCM), PWA y tareas programadas en producción. Las notificaciones automáticas se calculan y ejecutan siempre en horario de Ecuador (`America/Guayaquil`).

### Características Principales

- **Horario fijo de producción**: `dailyNotifications` y `weeklyNotifications` corren a las `09:00` de Ecuador. `councilNotifications` corre martes y miércoles a las `18:00` de Ecuador.
- **Push por dispositivo**: Cada móvil/PWA guarda un documento en `c_push_subscriptions` con trazabilidad de intentos.
- **Control del usuario**: Cada usuario puede desactivar las notificaciones desde Settings
- **Notificaciones in-app**: Todas las notificaciones se muestran en el header de la aplicación
- **Filtrado inteligente**: Solo se envían notificaciones a usuarios que las tienen activadas
- **Diagnóstico integrado**: Settings muestra el estado del service worker, permiso, device ID y el último intento del servidor.

### Variables de Entorno Requeridas

Variables mínimas para FCM y diagnóstico:

```env
# Firebase Configuration
NEXT_PUBLIC_FIREBASE_API_KEY=tu-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=tu-proyecto.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=tu-proyecto-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=tu-proyecto.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=tu-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=tu-app-id
FIREBASE_SERVICE_ACCOUNT_KEY={"key":"tu-service-account-key"}
NEXT_PUBLIC_VAPID_PUBLIC_KEY=tu-vapid-public-key
```

## Cómo Funcionan las Notificaciones

### Estado por Defecto

- **Todos los usuarios nuevos** tienen las notificaciones **in-app activadas por defecto**
- **Las notificaciones push móviles** requieren activación explícita por usuario/dispositivo
- No se requiere ninguna acción del usuario para empezar a recibir notificaciones
- Las notificaciones aparecen automáticamente en el header de la aplicación (campana)
- **Las notificaciones push se envían automáticamente a dispositivos móviles** mediante Firebase Cloud Messaging (FCM)
- Las notificaciones aparecen en la **barra de notificaciones del sistema operativo** (Android, iOS, etc.)

### Activar Notificaciones Push en Dispositivos

Para recibir notificaciones push en tu dispositivo móvil:

1. Abre la aplicación en tu navegador móvil (Chrome, Safari, etc.)
2. Ve a **Settings** (Configuración)
3. Haz clic en **"Activar Notificaciones"**
4. Acepta el permiso cuando el navegador lo solicite
5. ¡Listo! Ahora recibirás notificaciones push en tu dispositivo

**Nota para iOS (iPhone/iPad):**
- En iOS, las notificaciones push solo funcionan si instalas la aplicación como PWA (Progressive Web App)
- Para instalar: Abre Safari → Toca el botón "Compartir" → Selecciona "Añadir a pantalla de inicio"
- Una vez instalada, abre la app desde la pantalla de inicio y activa las notificaciones

### Desactivar Notificaciones (Opcional)

Si un usuario NO desea recibir notificaciones:

1. Inicia sesión en la aplicación
2. Ve a **Settings** (Configuración)
3. En la sección **Notifications**, desactiva el switch de notificaciones push
4. A partir de ese momento, NO recibirá notificaciones de ningún tipo

## Cómo Probar las Notificaciones

### Probar Notificación de Familia Urgente

1. Ve a **Ministración** > **Necesidades Urgentes**
2. Selecciona una familia de la lista
3. Agrega una observación describiendo la necesidad
4. Haz clic en **Marcar como Urgente**
5. Todos los usuarios con notificaciones activadas recibirán:
   - Una notificación en la app (campana en el header)
   - Una notificación push en su dispositivo

## Solución de Problemas

### El switch de notificaciones no cambia

**Problema**: El switch en Settings no responde o vuelve a su estado anterior.

**Soluciones**:
1. Verifica que estés conectado a internet
2. Revisa la consola del navegador para ver errores de Firestore
3. Asegúrate de tener permisos para modificar tu perfil de usuario
4. Intenta cerrar sesión y volver a iniciar sesión

### No veo notificaciones en el header

**Problema**: Marqué una familia como urgente pero no aparece la notificación.

**Soluciones**:
1. Verifica que tu switch de notificaciones esté **ACTIVADO** en Settings
2. Recarga la página para actualizar las notificaciones
3. Revisa que la notificación se haya creado en Firestore (colección `c_notifications`)
4. Verifica que tu `userId` coincida con el de la sesión actual

### No recibo notificaciones push en mi dispositivo móvil

**Problema**: No aparecen notificaciones en la barra de notificaciones del sistema operativo.

**Soluciones**:

**Para Android:**
1. Verifica que hayas aceptado el permiso de notificaciones en el navegador
2. Asegúrate de que las notificaciones del navegador estén habilitadas en la configuración del sistema
3. Abre Chrome → Configuración → Notificaciones → Verifica que el sitio tenga permisos
4. Prueba cerrar y volver a abrir el navegador

**Para iOS (iPhone/iPad):**
1. **IMPORTANTE**: Las notificaciones push solo funcionan si instalas la app como PWA
2. Instala la app: Safari → Botón "Compartir" → "Añadir a pantalla de inicio"
3. Abre la app desde la pantalla de inicio (NO desde Safari)
4. Ve a Settings y activa las notificaciones
5. Acepta el permiso cuando se solicite
6. Verifica en Ajustes → Notificaciones que la app tenga permisos

**Verificación general:**
1. Abre la consola del navegador (DevTools)
2. Ve a Application → Service Workers
3. Verifica que el service worker activo sea `sw.js`
4. Revisa que tu token FCM esté guardado en Firestore (colección `c_push_subscriptions`)
5. Revisa en Settings el panel **Push en este dispositivo**
6. Prueba un `dry-run` desde Settings o una notificación de prueba desde la consola:
   ```javascript
   fetch('/api/send-fcm-notification', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       title: 'Prueba',
       body: 'Esta es una notificación de prueba',
       url: '/'
     })
   })
   ```

## Arquitectura Técnica

### Flujo de Notificaciones

1. **Usuario marca familia como urgente** → `urgentClient.tsx`
2. **Sistema verifica preferencias** → `notification-helpers.ts` filtra usuarios con notificaciones activas
3. **Se crean notificaciones in-app** → Firestore (colección `c_notifications`)
4. **Se envían notificaciones push automáticamente** → Cloud Functions programadas o API `/api/send-fcm-notification`
5. **Notificaciones aparecen en el header** → `notification-bell.tsx` las muestra
6. **Notificaciones push llegan a dispositivos** → Service worker `sw.js` las recibe
7. **Notificaciones aparecen en la barra del sistema** → Android/iOS muestran la notificación
8. **Usuario hace clic** → Navega a `/ministering/urgent`

### Archivos Clave

- `src/app/(main)/settings/page.tsx` - Configuración de preferencias de notificaciones
- `src/app/(main)/ministering/urgent/urgentClient.tsx` - Lógica para marcar familias urgentes
- `src/lib/notification-helpers.ts` - Helpers para crear notificaciones (con filtrado)
- `src/components/notification-bell.tsx` - Componente de notificaciones en el header
- `src/app/api/send-fcm-notification/route.ts` - API para enviar notificaciones FCM
- `public/sw.js` - Service worker efectivo de PWA/push en producción, generado por `next-pwa`
- `worker/index.js` - Worker personalizado que se inyecta en `sw.js` para acoplar Firebase Messaging al worker real
- `public/firebase-messaging-sw.js` - Worker autogenerado con la configuración FCM sincronizada desde `.env.local`
- `src/lib/firebase-messaging.ts` - Inicialización y manejo de FCM
- `src/app/api/push/diagnostics/route.ts` - Endpoint interno para diagnóstico y `dry-run`

### Modelo de Datos

**Colección `c_users`**:
```typescript
{
  userId: string,
  name: string,
  inAppNotificationsEnabled: boolean, // true por defecto
  pushNotificationsEnabled: boolean, // false por defecto hasta que el usuario active push en un dispositivo
  // ... otros campos
}
```

**Colección `c_notifications`**:
```typescript
{
  id: string,
  userId: string,
  title: string,
  body: string,
  createdAt: Timestamp,
  isRead: boolean,
  contextType: 'urgent_family' | 'activity' | ...,
  actionUrl: string
}
```

**Colección `c_push_subscriptions`**:
```typescript
{
  userId: string,
  deviceId: string,
  fcmToken: string, // Token FCM para notificaciones push
  subscribedAt?: Date,
  updatedAt?: Date,
  userAgent: string,
  unsubscribedAt?: Date,
  lastPushAttemptAt?: Date,
  lastPushAttemptMode?: 'live' | 'dry-run',
  lastPushResult?: 'success' | 'failure' | 'invalid-token',
  lastPushErrorCode?: string | null,
  lastNotificationTag?: string | null
}
```

## Verificación

Para verificar que todo está funcionando correctamente:

1. **Verifica el service worker**:
   - Abre DevTools > Application > Service Workers
   - Deberías ver `sw.js` registrado y activo en producción

2. **Verifica la suscripción**:
   - Abre DevTools > Application > Storage > IndexedDB
   - Busca la colección `pushSubscriptions` en Firestore
   - Deberías ver tu suscripción guardada

3. **Prueba manual**:
  - En desarrollo (`pnpm dev`) el service worker se desactiva, así que no uses ese ambiente para validar push móvil
  - Antes de desplegar o probar producción, ejecuta `pnpm build` para regenerar `public/sw.js` y `public/firebase-messaging-sw.js`
   - Para validar producción usa el panel **Push en este dispositivo** en Settings
   - Usa la consola del navegador para enviar una notificación de prueba:
   ```javascript
   fetch('/api/send-fcm-notification', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       title: 'Prueba',
       body: 'Esta es una notificación de prueba',
       url: '/'
     })
   })
   ```

## Seguridad

- Las claves VAPID privadas **NUNCA** deben exponerse en el cliente
- Solo la clave pública VAPID se incluye en el código del cliente
- Las notificaciones push se envían desde el servidor usando la clave privada
- Las suscripciones se almacenan de forma segura en Firestore

## Limitaciones Conocidas

- **iOS Safari**: Las notificaciones push solo funcionan si la app está instalada como PWA
- **Modo desarrollo**: Las notificaciones push están deshabilitadas en desarrollo porque el service worker se limpia intencionalmente
- **Permisos**: Si el usuario deniega los permisos, debe habilitarlos manualmente en la configuración del navegador
