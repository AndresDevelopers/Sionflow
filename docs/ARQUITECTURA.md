# Arquitectura del Sistema

## Stack Tecnológico
- **Frontend**: Next.js 16 (App Router, webpack)
- **Lenguaje**: TypeScript 6.0
- **UI**: React 19, Tailwind CSS 3.4, Radix UI, shadcn/ui
- **Backend**: Firebase Cloud Functions (Node.js 22)
- **Base de Datos**: Firestore (NoSQL)
- **Autenticación**: Firebase Auth (client + admin SDK)
- **Almacenamiento**: Firebase Storage
- **IA**: DeepSeek API (`deepseek-v4-flash`) + Google Genkit
- **PWA**: `@ducanh2912/next-pwa` (offline, notificaciones push)
- **Gráficos**: Recharts
- **Formularios**: react-hook-form + zod
- **Exportación**: docxtemplater + docx
- **Package manager**: pnpm (workspace monorepo)
- **Deploy**: Vercel + Firebase
- **Notificaciones**: Web Push API + Firebase Cloud Messaging

## Estructura del Proyecto
```
src/
├── app/
│   ├── (auth)/                  # login, register, forgot-password
│   ├── (main)/                  # Rutas protegidas (15 módulos)
│   │   ├── admin/               # Panel de administración
│   │   ├── birthdays/           # Cumpleaños
│   │   ├── church-chat/         # Chat con IA
│   │   ├── converts/            # Conversos recientes
│   │   ├── council/             # Consejo
│   │   ├── donate/              # Donaciones
│   │   ├── family-search/       # FamilySearch
│   │   ├── future-members/      # Futuros miembros
│   │   ├── members/             # Miembros
│   │   ├── ministering/         # Ministración
│   │   ├── missionary-work/     # Obra misional
│   │   ├── observations/        # Observaciones de salud
│   │   ├── profile/             # Perfil de usuario
│   │   ├── reports/             # Reportes y actividades
│   │   ├── service/             # Servicio
│   │   └── settings/            # Ajustes
│   ├── api/                     # API routes + cron endpoints
│   └── manifest/                # PWA manifest
├── components/
│   ├── ui/                      # shadcn/ui
│   ├── dashboard/               # Widgets del dashboard
│   ├── members/                 # Componentes de miembros
│   └── shared/                  # Voice annotations, sync status, etc.
├── contexts/                    # auth-context, i18n-context
├── hooks/                       # use-members, use-permissions, etc.
├── lib/                         # firebase, collections, roles, deepseek, push, types
├── ai/flows/                    # Flujos Genkit (dashboard summary, suggestions)
└── locales/                     # es.json, en.json

functions/                       # Firebase Cloud Functions
├── src/index.ts                 # Reportes anuales, notificaciones, imágenes
└── src/modules/                 # notification-dispatcher, image-module

worker/                          # Service Worker bridge para FCM
scripts/                         # FCM config, changelog, setup-hooks, migración
public/                          # PWA assets, service worker, changelog.json
```

## Patrones de Diseño
- **Arquitectura por funcionalidad**: Organización del código por módulo de negocio
- **Renderizado cliente**: Toda la app usa `"use client"`, datos leídos directamente de Firestore
- **Aislamiento multi-tenant**: Datos filtrados por `barrioOrg` (barrio + organización) en cada consulta
- **RBAC**: Control de acceso basado en roles con permisos `read` y `all`

## Flujo de Datos
1. **Frontend**: Componentes React que leen/escriben Firestore directamente
2. **Auth**: Firebase Auth para identidad, Firestore para roles y permisos
3. **API Routes**: Endpoints server-side para operaciones seguras (push, reportes, API externa)
4. **Cloud Functions**: Tareas programadas (notificaciones de cumpleaños, reportes anuales)
5. **IA**: DeepSeek API llamada desde el frontend para resúmenes, sugerencias y chat

## Funcionalidades Clave

### Sistema de Sincronización de Ministración
Mantiene consistencia bidireccional entre compañerismos y maestros ministrantes:
- Sincronización automática al modificar/eliminar compañerismos
- Procesamiento por lotes eficiente (hasta 500 operaciones)
- Prevención de duplicados

### IA y Genkit
- **Resumen del dashboard**: Análisis del estado actual del quórum vía DeepSeek
- **Sugerencias**: Recomendaciones de actividades y servicio basadas en datos
- **Chat Iglesia**: Chat conversacional con contexto eclesiástico
- **Genkit**: Tooling de desarrollo para prototipar flujos de IA

### Notificaciones Push
- Web Push API + Firebase Cloud Messaging
- Vercel cron diario a las 13:00 para cumpleaños
- Notificaciones en primer plano y fondo

### PWA
- Instalable en dispositivos móviles y escritorio
- Funciona offline con Service Worker personalizado
- Sincronización al reconectar

## Decisiones de Diseño Clave
- **PWA**: Experiencia nativa sin App Store
- **Mobile-First**: Diseño responsivo optimizado para teléfonos
- **White-label**: Nombre, logo e icono configurables por variables de entorno
- **Multi-organización**: Aislamiento de datos por barrio + organización
- **IA integrada**: DeepSeek como asistente para la presidencia
