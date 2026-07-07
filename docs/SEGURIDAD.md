# Políticas de Seguridad

## Autenticación y Autorización

### Firebase Authentication
- Autenticación con email/contraseña
- Firebase Admin SDK para verificación server-side de tokens
- Sin proveedores OAuth externos

### Roles y Permisos

| Rol | Permiso | Acceso |
|---|---|---|
| `secretary` | Todo | Control total: admin, ajustes, gestión de roles, reportes |
| `president` | Todo | Módulos operativos + panel de admin |
| `counselor` | Todo | Seguimiento de familias y asignaciones |
| `other` | Lectura | Solo lectura de datos |
| `user` | Lectura | Bloqueado hasta asignación de rol de liderazgo |

- **Aislamiento multi-tenant**: cada usuario pertenece a un `barrioOrg`. Las consultas se filtran automáticamente por barrio + organización.
- **Visibilidad de páginas**: el menú lateral se puede configurar por usuario desde el panel de admin.
- Las cuentas con rol `user` ven la página de acceso restringido hasta que un líder les asigne un rol.

## Protección de Datos

### En Tránsito
- TLS 1.3 para todas las comunicaciones
- Firebase Auth con tokens firmados criptográficamente
- CORS configurado para orígenes autorizados

### En Reposo
- Firestore con cifrado nativo de Firebase
- Firebase Storage con cifrado server-side
- Claves de API en variables de entorno (nunca en código)

## Prácticas Seguras

### Desarrollo
- Variables de entorno para todos los datos sensibles
- Validación de entrada con zod en frontend y API routes
- Sin hardcoding de secretos ni URLs de Firebase

### Voz y Multimedia
- Reconocimiento de voz procesado localmente en el navegador (Web Speech API)
- Sin almacenamiento de audio original — solo texto transcrito
- Permiso explícito del navegador requerido para acceder al micrófono

### Notificaciones Push
- Tokens FCM almacenados por usuario en `c_push_subscriptions`
- Las notificaciones se generan desde Cloud Functions verificadas
- Los tokens se eliminan al invalidarse

## Respuesta a Incidentes

### Reporte de Vulnerabilidades
1. Reportar a través de GitHub Security Advisories
2. Se responderá en un plazo máximo de 48 horas
3. Seguimiento del principio de divulgación responsable

### Proceso de Mitigación
1. Contención del incidente
2. Análisis de impacto
3. Corrección de la vulnerabilidad
4. Pruebas de seguridad
5. Despliegue de la solución
6. Comunicación a los afectados (si aplica)

## Auditoría
- Logs de auditoría en Firestore para acciones críticas
- Registro de cambios de rol y permisos
- Revisiones de acceso periódicas
