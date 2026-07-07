# Configuración de Build

## Stack de Build

- **Next.js 16** con webpack (no Turbopack)
- **TypeScript 6.0** con `ignoreBuildErrors: true` (los errores de tipo no bloquean el build)
- **Source maps**: deshabilitados en desarrollo para evitar conflictos

## PWA

La PWA se configura con `@ducanh2912/next-pwa`:

- Service worker en `public/sw.js`
- Custom worker bridge en `worker/` para Firebase Cloud Messaging
- Deshabilitada en desarrollo (`NODE_ENV === 'development'`)
- Assets estáticos en `public/`

## Firebase Cloud Messaging

El script `scripts/update-fcm-config.js` se ejecuta antes de cada build (`prebuild`) para inyectar la configuración de Firebase en el service worker.

## Dependencias pre-aprobadas

En `pnpm-workspace.yaml` se declaran `onlyBuiltDependencies` para módulos que requieren compilación nativa:

- `@firebase/util`
- `esbuild`
- `protobufjs`
- `sharp`

## Imágenes

Configuración de `next.config.ts`:

- `unoptimized: true` — las imágenes se sirven sin optimización de Next.js
- Remote patterns permitidos: `placehold.co`, `picsum.photos`, `firebasestorage.googleapis.com`

## Variables de Entorno

Las variables con prefijo `NEXT_PUBLIC_` se exponen al cliente. Las demás solo están disponibles en el servidor.

Ver `.env.example` para la lista completa de variables requeridas.

## Comandos

| Comando | Descripción |
|---|---|
| `pnpm build` | Build de producción (incluye `update-fcm-config`) |
| `pnpm dev` | Desarrollo en puerto 9001 con webpack |
| `pnpm start` | Servidor de producción |
| `pnpm typecheck` | Verificación de tipos |
| `pnpm lint` | ESLint |
