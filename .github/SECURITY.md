# Política de Seguridad

## 🛡️ Reportando Vulnerabilidades

Agradecemos los reportes de seguridad de la comunidad. Por favor, sigue estas pautas para reportar vulnerabilidades de seguridad:

1. **No** reportes vulnerabilidades a través de issues públicos o discusiones
2. Usa el sistema de [Security Advisories de GitHub](https://github.com/AndresDevelopers/SionFlow/security/advisories/new)
3. Incluye una descripción detallada de la vulnerabilidad
4. Proporciona pasos para reproducir el problema
5. Si es posible, incluye código de prueba o capturas de pantalla

### ⏱️ Nuestro Compromiso

- Responderemos a tu reporte dentro de 48 horas
- Mantendremos una comunicación abierta durante el proceso
- Reconoceremos tu contribución en nuestras notas de versión (a menos que prefieras permanecer en el anonimato)

## 🚨 Vulnerabilidades Conocidas

Actualmente no hay vulnerabilidades de seguridad conocidas. Si descubres alguna, por favor repórtala siguiendo el proceso anterior.

## 🔄 Proceso de Actualización de Seguridad

1. Se evalúa el impacto de la vulnerabilidad reportada
2. Se desarrolla una solución
3. Se prueba la solución
4. Se publica una actualización de seguridad
5. Se notifica a los usuarios afectados

## 📜 Política de Divulgación Responsable

Seguimos los principios de divulgación responsable. Por favor, permite un tiempo razonable para corregir la vulnerabilidad antes de hacerla pública.

## 🛡️ Medidas de Seguridad Adicionales

- Autenticación con Firebase Auth (tokens firmados criptográficamente)
- Aislamiento multi-tenant por barrio + organización
- Control de acceso basado en roles
- Variables de entorno para todos los secretos
- Logs de auditoría en Firestore
