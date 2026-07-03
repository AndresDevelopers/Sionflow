# Configuración de Build y Dependencias

Este documento describe la configuración opcional de Sentry y los módulos pre-aprobados en el build.

## Sentry Opcional

A partir de esta versión, Sentry es completamente **opcional** en el build. Esto permite reducir el tamaño del bundle y las dependencias cuando no se necesita monitoreo de errores.

### Cómo activar/desactivar Sentry

Configura la variable de entorno `SENTRY_ENABLED` en tu `.env.local`:

```env
# Para desactivar Sentry (default es true)
SENTRY_ENABLED=false
```

Si estableces `SENTRY_ENABLED=false`:
- El módulo `@sentry/nextjs` no será cargado en el build
- No habrá overhead de Sentry en el bundle
- Los archivos de configuración de Sentry (`sentry.client.config.ts`, `sentry.edge.config.ts`) existirán pero serán ignorados

### Requisitos para Sentry (cuando está habilitado)

Si `SENTRY_ENABLED` no está establecido o es `true`, necesitas proporcionar:

```env
NEXT_PUBLIC_SENTRY_DSN=https://your-dsn@o0.ingest.sentry.io/
SENTRY_AUTH_TOKEN=your-sentry-auth-token
SENTRY_ORG=your-org-slug
SENTRY_PROJECT=your-project-slug
```

Si alguno de estos valores es inválido o no se proporciona, Sentry será automáticamente deshabilitado.

## Módulos Pre-aprobados en el Build

Los siguientes módulos están pre-aprobados para descargar sus componentes nativos durante el build:

- `@firebase/util` - Utilidades de Firebase
- `@sentry/cli` - CLI de Sentry
- `esbuild` - Bundler de JavaScript
- `protobufjs` - Compilación de Protocol Buffers
- `sharp` - Procesamiento de imágenes

Esta configuración se encuentra en `functions/pnpm-workspace.yaml` bajo `ignoredBuiltDependencies`.

## Cambios Realizados

### 1. `next.config.ts`
- Sentry ahora es importado dinámicamente
- Se verifica si `SENTRY_ENABLED` está deshabilitado
- El módulo `withSentryConfig` solo se aplica si Sentry está disponible y configurado

### 2. `src/app/error.tsx`
- Import condicional de Sentry
- Las excepciones solo se capturan si Sentry está disponible

### 3. `src/app/global-error.tsx`
- Import condicional de Sentry
- Manejo seguro de excepciones globales cuando Sentry no está disponible

### 4. `src/lib/sentry-replay-lazy.ts`
- Import condicional de `getCurrentHub` de Sentry
- La carga de Session Replay es graceful cuando Sentry no está disponible

### 5. `functions/pnpm-workspace.yaml`
- Agregados módulos pre-aprobados a `ignoredBuiltDependencies`

### 6. `.env.example`
- Agregada la variable `SENTRY_ENABLED`
- Documentado cómo desactivar Sentry

## Impacto en el Build

- **Con Sentry deshabilitado**: Reducción del tamaño del bundle (~40-60KB gzipped)
- **Dependencias removidas**: @sentry/nextjs, @sentry/replay y sus subdependencias
- **Mejor tiempo de build**: Menos modules para transpila y bundlear

## Ejemplo de Uso

Para builds sin Sentry (desarrollo local o ambientes sin monitoreo):

```bash
# En tu .env.local
SENTRY_ENABLED=false
npm run build
```

Para builds con Sentry (producción con monitoreo):

```bash
# En tu .env.local
SENTRY_ENABLED=true
NEXT_PUBLIC_SENTRY_DSN=your-dsn
SENTRY_AUTH_TOKEN=your-token
SENTRY_ORG=your-org
SENTRY_PROJECT=your-project
npm run build
```
