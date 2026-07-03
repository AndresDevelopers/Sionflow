# Arquitectura del Sistema

## Stack Tecnológico
- **Frontend**: Next.js 15 con TypeScript
- **Backend**: Firebase Functions (Node.js 20)
- **Base de Datos**: Firestore (NoSQL)
- **Autenticación**: Firebase Authentication
- **Almacenamiento**: Firebase Storage
- **Hosting**: Firebase Hosting / Vercel
- **CI/CD**: GitHub Actions
- **Monitoreo**: Sentry
- **Reconocimiento de Voz**: Web Speech API (nativo del navegador)

## Estructura del Proyecto
```
├── src/
│   ├── app/            # Rutas de la aplicación (Next.js App Router)
│   ├── components/     # Componentes reutilizables
│   │   ├── shared/     # Componentes compartidos (voice-annotations, etc.)
│   │   ├── dashboard/  # Componentes específicos del dashboard
│   │   └── ui/         # Componentes UI primitivos
│   ├── contexts/       # Contextos de React
│   ├── lib/            # Utilidades y configuraciones
│   │   ├── types.ts    # Definiciones de TypeScript
│   │   └── collections.ts # Referencias a colecciones de Firestore
│   └── hooks/          # Hooks personalizados
├── public/             # Archivos estáticos
├── functions/          # Código de Cloud Functions
│   ├── src/
│   │   ├── services/   # Lógica de negocio
│   │   ├── types/      # Tipos de TypeScript
│   │   └── index.ts    # Punto de entrada
└── docs/               # Documentación
```

## Patrones de Diseño
- **Arquitectura por Características**: Organización del código por funcionalidad
- **Repository Pattern**: Para el acceso a datos
- **Factory Pattern**: Para la creación de objetos complejos
- **Observer Pattern**: Para manejo de eventos
- **Inyección de Dependencias**: Para un código más testeable y mantenible

## Flujo de Datos
1. **Frontend**: Componentes React que consumen la API
2. **Caché Local**: Sistema de caché en localStorage para optimización
3. **API**: Firebase Functions que actúan como capa intermedia
4. **Base de Datos**: Firestore para almacenamiento persistente
5. **Autenticación**: Firebase Auth para gestión de usuarios
6. **Almacenamiento**: Firebase Storage para archivos multimedia

### Sistema de Caché
El sistema implementa una estrategia de caché híbrida:
- **Cache-first**: Carga inicial desde caché local si está disponible
- **Background sync**: Actualización automática en segundo plano
- **Invalidación inteligente**: Limpieza automática después de mutaciones
- **Cross-tab sync**: Sincronización entre múltiples pestañas del navegador

## Funcionalidades Avanzadas

### Sistema de Migración de Asignaciones Ministeriales
Herramienta automatizada para sincronizar maestros ministrantes con compañerismos:

#### Características:
- **Procesamiento por lotes**: Procesa miembros en grupos paralelos (configurable, default: 10)
- **Seguimiento de progreso**: Callback opcional para actualizar UI durante la migración
- **Modo de prueba (dry-run)**: Permite simular la migración sin hacer cambios reales
- **Manejo robusto de errores**: Continúa procesando incluso si algunos miembros fallan
- **Reporte detallado**: Estadísticas completas con miembros procesados, exitosos y fallidos

#### Flujo de Trabajo:
1. Obtiene todos los miembros de Firestore
2. Filtra miembros con maestros ministrantes asignados
3. Procesa en lotes paralelos para mejor rendimiento
4. Sincroniza cada asignación mediante `syncMinisteringAssignments()`
5. Genera reporte con estadísticas y errores

#### Estructura del Sistema:
- **Script**: `src/lib/migrate-ministering.ts`
- **Página UI**: `src/app/(main)/ministering/migrate/page.tsx`
- **Función principal**: `migrateExistingMinisteringAssignments(options)`

#### Opciones de Configuración:
```typescript
interface MigrationOptions {
  batchSize?: number;        // Tamaño del lote (default: 10)
  dryRun?: boolean;          // Modo de prueba (default: false)
  onProgress?: (current: number, total: number) => void;  // Callback de progreso
}
```

#### Resultado de la Migración:
```typescript
interface MigrationResult {
  success: boolean;          // true si no hubo errores
  totalMembers: number;      // Total de miembros en la base de datos
  processedMembers: number;  // Miembros con maestros asignados
  syncedMembers: number;     // Miembros sincronizados exitosamente
  failedMembers: Array<{     // Miembros que fallaron
    id: string;
    name: string;
    error: string;
  }>;
  duration: number;          // Tiempo de ejecución en ms
}
```

#### Uso Programático:
```typescript
import { migrateExistingMinisteringAssignments } from '@/lib/migrate-ministering';

// Uso básico
const result = await migrateExistingMinisteringAssignments();

// Con opciones avanzadas
const result = await migrateExistingMinisteringAssignments({
  batchSize: 20,
  dryRun: true,
  onProgress: (current, total) => {
    console.log(`Progreso: ${current}/${total}`);
  }
});
```

#### Consideraciones de Rendimiento:
- **Procesamiento paralelo**: ~10x más rápido que procesamiento secuencial
- **Optimización de lotes**: Ajustar `batchSize` según capacidad del servidor
- **Tiempo estimado**: ~6 segundos para 100 miembros (con batchSize=10)

### Sistema de Sincronización Inversa (Ministración → Miembros)
Mantiene la consistencia bidireccional entre compañerismos y maestros ministrantes:

#### Versiones Disponibles:
- **Versión estable**: `ministering-reverse-sync.ts` (producción)
- **Versión refactorizada**: `ministering-reverse-sync-refactored.ts` (mejorada, lista para uso)

#### Características:
- **Sincronización automática**: Actualiza miembros cuando se modifican compañerismos
- **Procesamiento por lotes**: Usa `writeBatch` para operaciones eficientes (límite: 500 operaciones)
- **Búsqueda por apellido**: Identifica familias mediante el formato "Familia [Apellido]"
- **Manejo de cambios complejos**: Soporta adición, eliminación y modificación de asignaciones
- **Procesamiento paralelo**: (versión refactorizada) Procesa familias en paralelo para mejor rendimiento
- **Caché inteligente**: (versión refactorizada) Evita consultas duplicadas a Firestore
- **Logging detallado**: (versión refactorizada) Registro completo de operaciones y errores

#### Funciones Principales:

**`removeMinisteringTeachersFromFamilies()`**
- Elimina maestros ministrantes cuando se borra un compañerismo
- Busca miembros por apellido de familia
- Actualiza solo miembros afectados

**`updateMinisteringTeachersOnCompanionshipChange()`**
- Sincroniza cambios cuando se edita un compañerismo
- Maneja tres escenarios:
  1. Familias removidas → elimina maestros
  2. Familias agregadas → añade maestros
  3. Familias existentes con compañeros cambiados → actualiza maestros

#### Estructura del Sistema:
- **Módulo estable**: `src/lib/ministering-reverse-sync.ts`
- **Módulo refactorizado**: `src/lib/ministering-reverse-sync-refactored.ts`
- **Usado por**: `CompanionshipForm.tsx`, páginas de ministración
- **Integración**: Se ejecuta automáticamente en operaciones CRUD de compañerismos

#### Mejoras en Versión Refactorizada:
- **Arquitectura modular**: Separación clara entre tipos, helpers y API pública
- **Validación de entrada**: Verifica datos antes de procesar
- **Manejo robusto de errores**: Retorna resultados detallados con miembros fallidos
- **Optimización de consultas**: Caché de miembros para evitar consultas repetidas
- **Procesamiento paralelo**: Usa `Promise.all()` para procesar familias simultáneamente
- **Comparación inteligente**: Solo actualiza miembros con cambios reales
- **Soporte multiidioma**: Detecta prefijos "Familia" y "Family"

#### Flujo de Sincronización:
```typescript
// Al eliminar compañerismo
await removeMinisteringTeachersFromFamilies(
  ['Juan Pérez', 'Pedro López'],  // Compañeros
  ['Familia García', 'Familia Rodríguez']  // Familias
);

// Al editar compañerismo
await updateMinisteringTeachersOnCompanionshipChange(
  ['Juan Pérez', 'Pedro López'],      // Compañeros antiguos
  ['Juan Pérez', 'Carlos Martínez'],  // Compañeros nuevos
  ['Familia García'],                  // Familias antiguas
  ['Familia García', 'Familia Silva']  // Familias nuevas
);
```

#### Consideraciones Técnicas:
- **Límite de batch**: 500 operaciones por lote (límite de Firestore)
- **Búsqueda eficiente**: Usa índices de Firestore en campo `lastName`
- **Prevención de duplicados**: Usa `Set` para evitar maestros repetidos
- **Logging detallado**: Registra cada cambio para auditoría
- **Caché de consultas**: (refactorizada) Evita consultas duplicadas a la misma familia
- **Procesamiento paralelo**: (refactorizada) Mejora rendimiento en operaciones masivas
- **Resultado estructurado**: (refactorizada) Retorna `SyncResult` con estadísticas completas

#### Resultado de Sincronización (Versión Refactorizada):
```typescript
interface SyncResult {
  success: boolean;          // true si no hubo errores
  updatedCount: number;      // Número de miembros actualizados
  failedMembers: Array<{     // Miembros que fallaron
    id: string;
    name: string;
    error: string;
  }>;
}
```

### Sistema de Caché Inteligente
Implementación de caché local para optimizar el rendimiento y la experiencia del usuario:

#### Características:
- **Persistencia local**: Almacenamiento en localStorage del navegador
- **Sincronización automática**: Actualización periódica cada 5 minutos
- **Invalidación consistente**: Limpieza automática tras operaciones CRUD
- **Comunicación entre pestañas**: Eventos personalizados y storage events
- **Fallback robusto**: Degradación elegante cuando el servidor no está disponible

#### Estrategia de Caché:
1. **Carga inicial**: Intenta cargar desde caché, luego actualiza desde servidor
2. **Operaciones CRUD**: Invalida caché inmediatamente y fuerza actualización
3. **Visibilidad de página**: Refresca datos al volver a la pestaña activa
4. **Auto-refresh**: Actualización automática cada 5 minutos en páginas visibles

#### Gestión de Versiones:
- **Timestamp**: Control de antigüedad de los datos
- **Version key**: Identificador único para cada actualización
- **Cross-tab events**: Propagación de cambios entre ventanas

### Sistema de Anotaciones por Voz
El componente `VoiceAnnotations` implementa reconocimiento de voz usando la Web Speech API:

#### Características:
- **Auto-inicio**: El reconocimiento se inicia automáticamente al abrir el diálogo
- **Idioma**: Configurado para español (es-ES)
- **Feedback visual**: Indicador de estado de grabación con animación
- **Fallback**: Entrada manual de texto como alternativa
- **Gestión de errores**: Manejo robusto de errores de la API de voz

#### Flujo de Trabajo:
1. Usuario abre diálogo de nueva anotación
2. Sistema inicia automáticamente el reconocimiento de voz
3. Usuario habla y el texto se transcribe en tiempo real
4. Usuario puede alternar entre voz y texto manual
5. Anotación se guarda en Firestore con metadatos de origen

#### Estructura del Componente:
- **Ubicación**: `src/components/shared/voice-annotations.tsx`
- **Exportación**: Disponible desde `src/components/shared/index.ts`
- **Importación**: `import { VoiceAnnotations } from '@/components/shared'`

#### Compatibilidad:
- **Navegadores soportados**: Chrome, Edge, Safari (con webkit)
- **Detección automática**: Verifica disponibilidad de la API antes de usar
- **Degradación elegante**: Funciona solo con texto si la voz no está disponible

## Decisiones de Diseño Clave
- **PWA**: Aplicación Web Progresiva para experiencia móvil
- **Mobile-First**: Diseño responsivo con enfoque en móviles
- **Seguridad**: Validación en frontend y backend
- **Rendimiento**: Carga bajo demanda y code-splitting
- **Procesamiento por lotes**: Operaciones masivas optimizadas con paralelización
- **Accesibilidad**: Reconocimiento de voz para facilitar la entrada de datos
- **Experiencia de Usuario**: Auto-inicio del reconocimiento de voz al abrir diálogos
- **Herramientas de migración**: Scripts automatizados para sincronización de datos
