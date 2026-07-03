# Documentación de la API

## Autenticación
Todas las solicitudes requieren autenticación mediante JWT.

Los tokens incluyen el atributo `role` con uno de los valores admitidos por la presidencia del quórum:

- `secretary`
- `president`
- `counselor`

Las cuentas recién registradas permanecen con `role: "user"` y no pueden acceder a los endpoints protegidos hasta que el secretario les asigne un rol de liderazgo.

```http
Authorization: Bearer [JWT_TOKEN]
```

## Endpoints

### Autenticación

#### Iniciar Sesión
```http
POST /api/auth/login
```
**Cuerpo de la solicitud:**
```json
{
  "email": "usuario@ejemplo.com",
  "password": "contraseña123"
}
```

**Respuesta exitosa (200 OK):**
```json
{
  "user": {
    "uid": "abc123",
    "email": "usuario@ejemplo.com",
    "displayName": "Nombre Usuario",
    "role": "secretary"
  },
  "token": "eyJhbGciOiJSUzI1NiIsImtpZCI6I..."
}
```

### Usuarios

#### Obtener perfil de usuario
```http
GET /api/users/me
```

**Respuesta exitosa (200 OK):**
```json
{
  "uid": "abc123",
  "email": "usuario@ejemplo.com",
  "displayName": "Nombre Usuario",
  "phoneNumber": "+1234567890",
  "birthDate": "1990-01-01",
  "address": "Calle Falsa 123",
  "groups": ["grupo1", "grupo2"],
  "role": "counselor",
  "createdAt": "2023-01-01T00:00:00.000Z"
}
```

#### Actualizar perfil de usuario
```http
PATCH /api/users/me
```

**Cuerpo de la solicitud:**
```json
{
  "displayName": "Nuevo Nombre",
  "phoneNumber": "+1234567890"
}
```

### Eventos

#### Listar eventos
```http
GET /api/events?start=2023-01-01&end=2023-01-31
```

**Parámetros de consulta:**
- `start`: Fecha de inicio (opcional)
- `end`: Fecha de fin (opcional)
- `type`: Tipo de evento (opcional)

**Respuesta exitosa (200 OK):**
```json
{
  "events": [
    {
      "id": "event1",
      "title": "Reunión de Oración",
      "description": "Reunión semanal de oración",
      "start": "2023-06-15T19:00:00-05:00",
      "end": "2023-06-15T21:00:00-05:00",
      "location": "Templo Principal",
      "type": "prayer",
      "attendees": ["user1", "user2"],
      "createdBy": "user1",
      "createdAt": "2023-06-10T10:00:00-05:00"
    }
  ]
}
```

### Anotaciones

#### Listar anotaciones
```http
GET /api/annotations?source=dashboard&isCouncilAction=false
```

**Parámetros de consulta:**
- `source`: Origen de la anotación ('dashboard', 'council', 'family-search', 'missionary-work')
- `isCouncilAction`: Filtrar por acciones de consejo (opcional)
- `isResolved`: Filtrar por estado resuelto (opcional)

**Respuesta exitosa (200 OK):**
```json
{
  "annotations": [
    {
      "id": "annotation_123",
      "text": "Contactar a la familia Pérez para ofrecer ayuda con la mudanza",
      "source": "dashboard",
      "isCouncilAction": false,
      "isResolved": false,
      "createdAt": "2023-06-15T19:00:00-05:00"
    }
  ]
}
```

#### Crear anotación
```http
POST /api/annotations
```

**Cuerpo de la solicitud:**
```json
{
  "text": "Contactar a la familia Pérez para ofrecer ayuda con la mudanza",
  "source": "dashboard",
  "isCouncilAction": false
}
```

**Respuesta exitosa (201 Created):**
```json
{
  "id": "annotation_123",
  "text": "Contactar a la familia Pérez para ofrecer ayuda con la mudanza",
  "source": "dashboard",
  "isCouncilAction": false,
  "isResolved": false,
  "createdAt": "2023-06-15T19:00:00-05:00"
}
```

#### Actualizar anotación
```http
PATCH /api/annotations/:id
```

**Cuerpo de la solicitud:**
```json
{
  "text": "Texto actualizado de la anotación",
  "isCouncilAction": true,
  "isResolved": false
}
```

#### Eliminar anotación
```http
DELETE /api/annotations/:id
```

**Respuesta exitosa (204 No Content)**

### Migración de Datos

#### Migrar asignaciones ministeriales
```http
POST /api/ministering/migrate
```

**Descripción**: Sincroniza automáticamente todos los maestros ministrantes asignados a miembros y crea los compañerismos correspondientes en la página de ministración.

**Permisos requeridos**: `secretary` o `admin`

**Cuerpo de la solicitud (opcional):**
```json
{
  "batchSize": 10,
  "dryRun": false
}
```

**Parámetros:**
- `batchSize` (opcional): Número de miembros a procesar en paralelo (default: 10)
- `dryRun` (opcional): Si es true, simula la migración sin hacer cambios (default: false)

**Respuesta exitosa (200 OK):**
```json
{
  "success": true,
  "totalMembers": 150,
  "processedMembers": 45,
  "syncedMembers": 43,
  "failedMembers": [
    {
      "id": "member_123",
      "name": "Juan Pérez",
      "error": "Network timeout"
    }
  ],
  "duration": 5432
}
```

**Campos de respuesta:**
- `success`: Indica si la migración completó sin errores
- `totalMembers`: Total de miembros en la base de datos
- `processedMembers`: Miembros que tienen maestros ministrantes asignados
- `syncedMembers`: Miembros sincronizados exitosamente
- `failedMembers`: Array de miembros que fallaron con detalles del error
- `duration`: Tiempo de ejecución en milisegundos

**Notas:**
- Es seguro ejecutar esta operación múltiples veces
- No duplica compañerismos existentes
- Procesa solo miembros con maestros ministrantes asignados
- Recomendado ejecutar en modo `dryRun: true` primero para verificar

### Donaciones

#### Crear donación
```http
POST /api/donations
```

**Cuerpo de la solicitud:**
```json
{
  "amount": 100.50,
  "currency": "USD",
  "paymentMethod": "credit_card",
  "type": "tithe",
  "notes": "Diezmo junio 2023"
}
```

**Respuesta exitosa (201 Created):**
```json
{
  "id": "donation_123",
  "amount": 100.50,
  "currency": "USD",
  "status": "completed",
  "receiptUrl": "https://example.com/receipts/donation_123"
}
```

## Códigos de Estado HTTP
- `200 OK`: Solicitud exitosa
- `201 Created`: Recurso creado exitosamente
- `400 Bad Request`: Error en la solicitud
- `401 Unauthorized`: No autenticado
- `403 Forbidden`: No autorizado
- `404 Not Found`: Recurso no encontrado
- `500 Internal Server Error`: Error del servidor

## Errores
Los errores siguen el siguiente formato:
```json
{
  "error": {
    "code": "auth/invalid-email",
    "message": "El correo electrónico proporcionado no es válido."
  }
}
```

## Límites de Tasa
- 1000 solicitudes por minuto por IP
- 10000 solicitudes por día por usuario

## Versión
La versión actual de la API es `v1`. Todas las rutas están precedidas por `/api/v1/`.
