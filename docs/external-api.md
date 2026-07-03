# API Externa de QuorumFlow — Documentación

Esta API permite a una aplicación web externa leer datos de **ministración**, **actividades** y **servicios** de QuorumFlow, respetando el aislamiento multi-tenant por barrio + organización.

---

## Seguridad — Cómo funciona la API

### Capa 1: Autenticación con Firebase ID Token

La web externa NO usa una API key estática. En su lugar se autentica como un **usuario real de Firebase Auth** y envía el **ID token** en cada llamada. La API lo verifica con el **Firebase Admin SDK** (`verifyIdToken`), lo que garantiza:

- El token es emitido por el proyecto Firebase correcto (`quorumflow-dlqh0`).
- No ha expirado (Firebase los rota automáticamente cada hora).
- No fue manipulado (firmado criptográficamente por Firebase).

```ts
// server-side: src/app/api/external/*/route.ts
const decoded = await authAdmin.verifyIdToken(token);
```

### Capa 2: Resolución dinámica de barrio + organización

Una vez verificado el token, la API usa el `uid` del usuario para leer su documento en `c_users` y extraer `barrio` y `organizacion`.

```ts
const userDoc = await firestoreAdmin.collection('c_users').doc(decoded.uid).get();
const { barrio, organizacion } = userDoc.data();
const barrioOrg = `${barrio}|${organizacion}`;
```

Esto significa que **no hay un `EXTERNAL_BARRIO_ORG` estático en `.env`** — el alcance de los datos se determina automáticamente según quién se autentica.

### Capa 3: Aislamiento multi-tenant en Firestore

Todas las queries a Firestore incluyen un filtro obligatorio por `barrioOrg`:

```ts
const q = query(collection, where('barrioOrg', '==', barrioOrg));
```

Esto asegura que un usuario del barrio *Libertad* nunca vea datos del barrio *Los Chillos*, incluso si su token es válido.

### Capa 4: Control de roles

Solo usuarios con rol de liderazgo pueden llamar la API. La función `normalizeRole` del módulo `@/lib/roles` bloquea a usuarios con rol `user` o sin rol asignado:

```ts
const role = normalizeRole(data.role);
if (!role || role === 'user') {
  return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
}
```

| Rol | Acceso |
|---|---|
| `secretary` | ✅ |
| `president` | ✅ |
| `counselor` | ✅ |
| `user` (pendiente) | ❌ |

### Capa 5: Endpoints de solo lectura

Cada archivo `route.ts` solo exporta la función `GET`. No existen `POST`, `PUT` ni `DELETE`. Si alguien intenta escribir, Next.js devuelve automáticamente `405 Method Not Allowed`.

### Capa 6: Cache en producción

En producción los datos se cachean por 1 hora con `unstable_cache`. Esto protege contra llamadas repetitivas excesivas que puedan saturar Firestore. En desarrollo el cache está deshabilitado.

---

## Qué necesita QuorumFlow para que la API funcione

### 1. Variables de entorno en QuorumFlow

| Variable | Archivo | Obligatoria | Nota |
|---|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_KEY` | `.env.local` | Sí | La misma que ya usa `firebase-admin.ts` para verificar tokens |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `.env.local` | Sí | Ya configurada |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `.env.local` | Sí | Ya configurada |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | `.env.local` | Sí | Ya configurada |

> No se necesitan variables nuevas — la API reutiliza las mismas credenciales de Firebase Admin que ya usa el resto de la app.

### 2. Usuario registrado en `c_users`

El documento en Firestore debe tener la estructura:

```json
{
  "role": "secretary",
  "barrio": "Libertad",
  "organizacion": "Quórum de Élderes",
  "email": "api@ejemplo.com"
}
```

El valor de `barrioOrg` se construye en cada llamada como `barrio|organizacion` (ej: `Libertad|Quórum de Élderes`).

### 3. Firebase Auth con `email/password` habilitado

El proveedor de autenticación **Correo electrónico/contraseña** debe estar activado en la consola de Firebase:

```
Firebase Console → Authentication → Sign-in method → Email/Password → Habilitado
```

### 4. Colecciones en Firestore con campo `barrioOrg`

La API consulta estas colecciones y todas deben tener el campo `barrioOrg` en sus documentos:

| Colección | Nombre Firestore |
|---|---|
| Ministración | `c_ministracion` |
| Distritos de ministración | `c_ministracion_distritos` |
| Actividades | `c_actividades` |
| Servicios | `c_servicios` |

### 5. Índices compuestos en Firestore

La API usa queries con filtros compuestos. Estos índices ya existen en `firestore.indexes.json`:

| Colección | Campos del índice |
|---|---|
| `c_ministracion` | `barrioOrg ASC`, `companions ASC` |
| `c_actividades` | `barrioOrg ASC`, `date DESC` |
| `c_actividades` | `barrioOrg ASC`, `date ASC` |
| `c_servicios` | `barrioOrg ASC`, `date DESC` |
| `c_servicios` | `barrioOrg ASC`, `date ASC` |

El índice para `c_ministracion_distritos` (`barrioOrg ASC`, `name ASC`) puede necesitar crearse si no existe.

---

## Qué necesita la web externa

> La web externa puede estar hecha con cualquier stack: **Supabase, Laravel, Django, Express, Next.js, etc.** No importa qué base de datos o backend use. Lo único que necesita de Firebase es **el cliente de autenticación** para obtener el ID token que autoriza las llamadas a la API de QuorumFlow.

### 1. Instalar Firebase Auth SDK

Aunque la web externa use Supabase u otra base de datos, necesita el SDK de Firebase **solo para autenticación**:

```bash
npm install firebase
# o
pnpm add firebase
```

### 2. Configuración de Firebase

Inicializar Firebase con las variables del proyecto QuorumFlow:

```js
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

const firebaseConfig = {
  apiKey: '...',            // NEXT_PUBLIC_FIREBASE_API_KEY de QuorumFlow
  authDomain: '...',        // NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN de QuorumFlow
  projectId: '...',         // NEXT_PUBLIC_FIREBASE_PROJECT_ID de QuorumFlow
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
```

> Este `initializeApp` **no reemplaza** la inicialización de Supabase ni interfiere con ella. La web externa sigue usando Supabase para todo lo demás. Firebase se usa exclusivamente para obtener el token de autenticación que QuorumFlow exige.

### 3. Credenciales de usuario

Debe tener email + contraseña de un usuario registrado en `c_users` de QuorumFlow con `role`, `barrio` y `organizacion`. Puede guardar estas credenciales en su propia base de datos (Supabase, PostgreSQL, etc.) o en variables de entorno.

```js
// Ejemplo: credenciales guardadas en .env de la web externa
const email = process.env.QUORUMFLOW_EMAIL;
const password = process.env.QUORUMFLOW_PASSWORD;

await signInWithEmailAndPassword(auth, email, password);
const token = await auth.currentUser.getIdToken();
```

### 4. Obtener ID token antes de cada llamada

Firebase rota los tokens cada hora. La web externa debe obtener un token fresco con `getIdToken()` antes de llamar a la API, o forzar el refresh con `getIdToken(true)` si el token actual expiró.

```js
async function fetchData(endpoint, year) {
  const token = await auth.currentUser.getIdToken();
  const url = year
    ? `https://<quorumflow-domain>/api/external/${endpoint}?year=${year}`
    : `https://<quorumflow-domain>/api/external/${endpoint}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    // Token expirado, forzar refresh y reintentar
    const freshToken = await auth.currentUser.getIdToken(true);
    return fetch(url, {
      headers: { Authorization: `Bearer ${freshToken}` },
    }).then(r => r.json());
  }

  return res.json();
}

// Uso:
const ministering = await fetchData('ministering');
const activities = await fetchData('activities', 2026);
const services = await fetchData('services', 2026);
```

### 5. URL base de QuorumFlow

```
https://<quorumflow-domain>/api/external
```

---

## Endpoints

### Ministración

```
GET /api/external/ministering
Authorization: Bearer <id-token>
```

**Devuelve:**

```json
{
  "companionships": [
    {
      "id": "abc123",
      "companions": ["Juan Pérez", "Carlos Gómez"],
      "families": [
        {
          "name": "Familia Rodríguez",
          "isUrgent": false,
          "observation": "",
          "memberId": "xyz789"
        }
      ]
    }
  ],
  "districts": [
    {
      "id": "dist1",
      "name": "Distrito 1",
      "companionshipIds": ["abc123"],
      "leaderId": null,
      "leaderName": null
    }
  ]
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `companionships` | array | Todos los acompañamientos del barrio+organización |
| `companionships[].companions` | string[] | Nombres de los maestros ministrantes |
| `companionships[].families` | array | Familias asignadas a este acompañamiento |
| `companionships[].families[].isUrgent` | boolean | Si la familia tiene necesidad urgente |
| `companionships[].families[].observation` | string | Observación registrada |
| `companionships[].families[].memberId` | string? | ID del miembro vinculado (si existe) |
| `districts` | array | Todos los distritos del barrio+organización |
| `districts[].companionshipIds` | string[] | IDs de acompañamientos en este distrito |
| `districts[].leaderId` | string? | ID del líder de distrito |
| `districts[].leaderName` | string? | Nombre del líder de distrito |

---

### Actividades

```
GET /api/external/activities?year=2026
Authorization: Bearer <id-token>
```

**Parámetros:** `year` (opcional) — filtra actividades por año. Si se omite, devuelve todas.

**Devuelve:**

```json
[
  {
    "id": "act001",
    "title": "Noche de hogar",
    "date": "2026-06-15T19:00:00.000Z",
    "description": "Actividad de integración con los jóvenes",
    "time": "19:00",
    "imageUrls": ["https://storage.../foto1.jpg"],
    "location": "Capilla Libertad",
    "context": "Fortalecer la unidad del quórum",
    "learning": "La importancia del servicio mutuo",
    "additionalText": "Traer refrigerio"
  }
]
```

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | string | ID del documento en Firestore |
| `title` | string | Título de la actividad |
| `date` | string (ISO 8601) | Fecha de la actividad |
| `description` | string | Descripción |
| `time` | string? | Hora (HH:MM) |
| `imageUrls` | string[]? | URLs de imágenes en Firebase Storage |
| `location` | string? | Dónde sucedió |
| `context` | string? | Contexto de la actividad |
| `learning` | string? | Qué se aprendió |
| `additionalText` | string? | Texto adicional |

---

### Servicios

```
GET /api/external/services?year=2026
Authorization: Bearer <id-token>
```

**Parámetros:** `year` (opcional) — filtra servicios por año. Si se omite, devuelve todos.

**Devuelve:**

```json
[
  {
    "id": "svc001",
    "title": "Ayuda de mudanza",
    "date": "2026-06-20T14:00:00.000Z",
    "description": "Mudanza de la familia García",
    "time": "14:00",
    "councilNotified": true,
    "imageUrls": []
  }
]
```

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | string | ID del documento en Firestore |
| `title` | string | Título del servicio |
| `date` | string (ISO 8601) | Fecha del servicio |
| `description` | string | Descripción |
| `time` | string? | Hora (HH:MM) |
| `councilNotified` | boolean? | Si se notificó al consejo |
| `imageUrls` | string[]? | URLs de imágenes en Firebase Storage |

---

## Errores

| Código | Mensaje | Causa |
|---|---|---|
| `401` | `Missing bearer token` | No se envió header `Authorization` |
| `401` | `Invalid or expired token` | Token inválido o expirado (volver a obtener con `getIdToken()`) |
| `403` | `User not found` | El usuario no existe en `c_users` |
| `403` | `Insufficient permissions` | El rol del usuario es `user` o no tiene rol |
| `500` | `Failed to fetch ...` + `details` | Error interno del servidor |

---

## Flujo completo

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Web externa     │────▶│  Firebase Auth    │────▶│  QuorumFlow API │
│                 │     │  (verify token)   │     │  (route.ts)     │
│ signIn +        │     │                   │     │                 │
│ getIdToken()    │     │ authAdmin         │     │ leer c_users    │
│                 │     │ .verifyIdToken()  │     │ → barrioOrg     │
│                 │     │                   │     │                 │
│                 │     │                   │     │ query Firestore │
│                 │     │                   │     │ con barrioOrg   │
│                 │     │                   │     │                 │
│ ◀─────────────────────│ JSON con datos ──│◀────│                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

1. La web externa inicia sesión con Firebase Auth usando credenciales del usuario registrado en QuorumFlow
2. Obtiene el ID token con `getIdToken()`
3. Llama al endpoint con `Authorization: Bearer <token>`
4. La API verifica el token con Firebase Admin SDK
5. Lee `c_users/{uid}` para obtener `barrio` y `organizacion`
6. Consulta Firestore filtrando por `barrioOrg`
7. Devuelve los datos en JSON, con fechas en formato ISO 8601
