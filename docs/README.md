# Documentación del Proyecto Iglesia (Elderes)

## Tabla de Contenidos
1. [Visión General](#visión-general)
2. [Arquitectura](#arquitectura)
3. [Guía de Desarrollo](#guía-de-desarrollo)
4. [Despliegue](#despliegue)
5. [Seguridad](#seguridad)
6. [API](#api)
7. [Base de Datos](#base-de-datos)
8. [Migración de Datos](#migración-de-datos)
9. [Pruebas](#pruebas)
10. [Contribución](#contribución)
11. [FAQ](#faq)
12. [Matriz de Cumplimiento](#matriz-de-cumplimiento)
13. [Reportes Anuales](#reportes-anuales)

## Visión General
Documento principal que describe el propósito, alcance y objetivos del proyecto. La vista de conversos muestra los amigos asignados por nombre cuando existen miembros vinculados.

## Arquitectura
Descripción detallada de la arquitectura del sistema, patrones de diseño y decisiones técnicas.

## Guía de Desarrollo
Instrucciones para configurar el entorno de desarrollo y flujo de trabajo.

## Despliegue
Guías para despliegue en diferentes entornos (desarrollo, staging, producción).

## Seguridad
Políticas y prácticas de seguridad implementadas en el proyecto.

## API
Documentación detallada de los endpoints de la API.

## Base de Datos
Esquema de la base de datos y guía de migraciones. La colección c_conversos_info incluye campos calling, notes, recommendationActive y selfRelianceCourse para el seguimiento de nuevos conversos. La colección c_miembros admite el campo opcional deathDate para registrar fecha de fallecimiento.

## Migración de Datos
Guía completa para la migración automática de asignaciones ministeriales. Consultar [MIGRACION.md](./MIGRACION.md) para instrucciones detalladas sobre cómo sincronizar maestros ministrantes con compañerismos.

## Sincronización de Ministración
Sistema de sincronización bidireccional entre Compañerismos y Maestros Ministrantes. Consultar [SINCRONIZACION-MINISTRACION.md](./SINCRONIZACION-MINISTRACION.md) para documentación técnica completa sobre el funcionamiento, integración y mantenimiento del sistema de sincronización automática.

## Pruebas
Estrategia de pruebas y guía para ejecutarlas.

## Contribución
Guía para contribuir al proyecto.

## FAQ
Preguntas frecuentes y soluciones a problemas comunes.

## Matriz de Cumplimiento
Resumen del estado de las reglas personalizadas y hoja de ruta priorizada. Consultar [COMPLIANCE.md](./COMPLIANCE.md) para el detalle actualizado.

## Reportes Anuales
Configuración completa de la generación de reportes en Cloud Functions y la plantilla DOCX disponible en [REPORTES.md](./REPORTES.md).
