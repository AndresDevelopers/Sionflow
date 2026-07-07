# Documentación de la API

## Autenticación

La API usa Firebase Auth ID tokens. No se usan API keys estáticas ni JWT propios.

### Obtener un token

```js
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

const auth = getAuth();
await signInWithEmailAndPassword(auth, email, password);
const token = await auth.currentUser.getIdToken();
```

### Usar el token

```http
Authorization: Bearer <firebase-id-token>
```

### Roles

Los endpoints protegidos requieren roles de liderazgo. Las cuentas con rol `user` no tienen acceso.

| Rol | Acceso API |
|---|---|
| `secretary` | ✅ |
| `president` | ✅ |
| `counselor` | ✅ |
| `other` | ❌ |
| `user` | ❌ |

---

## API Externa

Permite a aplicaciones externas leer datos de ministración, actividades y servicios respetando el aislamiento `barrioOrg`.

Ver [docs/external-api.md](external-api.md) para documentación completa.

### Endpoints

```
GET /api/external/ministering
GET /api/external/activities?year=2026
GET /api/external/services?year=2026
```

---

## Notificaciones Push

### Registrar dispositivo

Los dispositivos se registran automáticamente desde el frontend al suscribirse en Ajustes. El token FCM se almacena en `c_push_subscriptions`.

### Notificaciones automáticas

- **Cumpleaños**: Vercel cron diario a las 13:00 (hora Ecuador) vía `/api/birthday-notifications`
- **Consejo**: Cloud Function programada martes y miércoles a las 18:00

### Enviar notificación manual

```
POST /api/send-push-notification
Authorization: Bearer <token>

{
  "title": "Reunión de presidencia",
  "body": "Mañana a las 19:00 en la capilla",
  "targetUsers": ["uid1", "uid2"]
}
```

---

## Endpoints del Dashboard

### Resumen IA

```
GET /api/suggestions/dashboard-summary
Authorization: Bearer <token>
```

Genera un resumen del estado actual del quórum usando DeepSeek.

### Sugerencias de actividades

```
GET /api/suggestions/activities
Authorization: Bearer <token>
```

Sugerencias de actividades basadas en datos del quórum.

---

## Church Chat

```
POST /api/church-chat
Authorization: Bearer <token>

{
  "messages": [
    { "role": "user", "content": "¿Cómo puedo ayudar a un converso reciente?" }
  ]
}
```

Chat conversacional con DeepSeek (`deepseek-v4-flash`).

---

## Códigos de Estado

| Código | Significado |
|---|---|
| `200` | Éxito |
| `401` | Token inválido o expirado |
| `403` | Usuario sin permisos suficientes |
| `404` | Recurso no encontrado |
| `405` | Método no permitido |
| `500` | Error interno |

---

## Aislamiento Multi-tenant

Todas las queries de la API filtran por `barrioOrg` (barrio + organización del usuario autenticado). Un usuario del barrio *Libertad* nunca verá datos del barrio *Los Chillos*.
