# Políticas de Seguridad

## Autenticación y Autorización

### Firebase Authentication
- Autenticación con email/contraseña
- Proveedores OAuth (Google, Facebook)
- Autenticación anónima para características limitadas

### Niveles de Acceso
1. **Usuario en espera (`user`)**: Cuenta autenticada sin privilegios operativos. Solo puede ver la página de acceso restringido hasta que la presidencia asigne un rol ministerial.
2. **Consejero del quórum (`counselor`)**: Acceso operativo para gestionar ministraciones, registrar seguimiento y consultar reportes de su área. No puede modificar permisos ni configuraciones globales.
3. **Presidente del quórum (`president`)**: Acceso completo a los indicadores y reportes estratégicos. Puede coordinar tareas con el secretario y los consejeros, pero no administra roles de usuario.
4. **Secretario del quórum (`secretary`)**: Control total del sistema. Es el único rol con permisos para abrir la sección de Gestión de Roles de Usuarios, asignar o revocar privilegios y modificar configuraciones críticas.

## Protección de Datos

### En Tránsito
- TLS 1.2+ para todas las comunicaciones
- HSTS habilitado
- CORS configurado estrictamente

### En Reposo
- Cifrado AES-256 para datos sensibles
- Hash con sal para contraseñas (Firebase Auth)
- Claves de API rotadas regularmente

## Reglas de Seguridad

### Firestore
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Reglas específicas por colección
    match /usuarios/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    match /eventos/{eventId} {
      allow read: if hasLeadershipAccess();
      allow create, update, delete: if isSecretary();
    }

    // Funciones auxiliares
    function hasLeadershipAccess() {
      return request.auth != null &&
        (request.auth.token.role in ['secretary', 'president', 'counselor']);
    }

    function isSecretary() {
      return request.auth.token.role == 'secretary';
    }
  }
}
```

### Storage
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if isSecretary();
    }
  }
}
```

## Prácticas Seguras

### Desarrollo Seguro
- Revisión de código obligatoria
- No exponer claves en el código
- Uso de variables de entorno para datos sensibles
- Validación de entrada en frontend y backend
- Las notificaciones push se generan desde Cloud Functions verificadas; los tokens se almacenan por usuario y se eliminan cuando se invalidan

### Funcionalidades de Voz
- **Permisos del navegador**: Solicitud explícita de acceso al micrófono
- **Procesamiento local**: El reconocimiento de voz se procesa en el navegador (no se envía audio a servidores externos)
- **Limpieza de recursos**: Detención automática del reconocimiento al cerrar diálogos
- **Fallback seguro**: Funcionalidad completa disponible sin acceso al micrófono
- **Sin almacenamiento de audio**: Solo se almacena el texto transcrito, nunca el audio original

### Contraseñas
- Longitud mínima: 12 caracteres
- Requiere mayúsculas, minúsculas, números y caracteres especiales
- Bloqueo después de 5 intentos fallidos

### Auditoría y Monitoreo
- Registro de eventos de seguridad
- Alertas para actividades sospechosas
- Revisiones de seguridad trimestrales

## Respuesta a Incidentes

### Reporte de Vulnerabilidades
1. Reportar a security@iglesiaelderes.com
2. Se responderá en un plazo máximo de 48 horas
3. Se emitirá un acuse de recibo
4. Se mantendrá informado al reportante

### Proceso de Mitigación
1. Contención del incidente
2. Análisis de impacto
3. Corrección de la vulnerabilidad
4. Pruebas de seguridad
5. Despliegue de la solución
6. Comunicación a los afectados

## Cumplimiento

### RGPD
- Derecho al olvido implementado
- Consentimiento explícito para datos personales
- Nombreado de Oficial de Protección de Datos

### Otras Regulaciones
- COPPA (para menores de 13 años)
- CCPA (para residentes de California)
- LGPD (para usuarios brasileños)

## Auditorías Externas
- Pruebas de penetración anuales
- Revisión de código por terceros
- Certificaciones de seguridad
