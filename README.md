# 🕊️ SionFlow — Sistema de Gestión para la Presidencia del Quórum y la Sociedad de Socorro

Aplicación web moderna (PWA) diseñada para las presidencias del Quórum de Élderes y la Sociedad de Socorro — presidente, consejeros y secretario — en la Iglesia de Jesucristo de los Santos de los Últimos Días. Digitaliza y centraliza las responsabilidades administrativas y pastorales de ambas organizaciones.

> **White-label + multi-organización**: El nombre, logo e ícono de la app son configurables mediante variables de entorno (`NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_LOGO`, `NEXT_PUBLIC_APP_ICON`). La app soporta múltiples organizaciones por barrio (Quórum de Élderes, Sociedad de Socorro, etc.) con datos aislados por `barrioOrg`. "SionFlow" es el nombre por defecto en este repositorio.

---

## 📱 Módulos

| Módulo | Qué hace |
|---|---|
| **Dashboard** | KPIs, resumen generado por IA, actividades próximas, cumpleaños, miembros fallecidos con obra vicaria pendiente |
| **Miembros** | CRUD de miembros, incluyendo estados (activo/menos activo/inactivo/fallecido), ordenanzas, asignaciones ministeriales |
| **Observaciones** | Preocupaciones de salud con helpers asignados |
| **Conversos** | Seguimiento de conversos recientes (ventana de 24 meses), acciones del consejo |
| **Futuros Miembros** | Fechas de bautismo programadas, marcar como bautizado, fotos de bautismo |
| **Ministración** | Compañerismos, distritos, familias asignadas, historial de visitas, sincronización bidireccional miembros↔compañerismos |
| **Cumpleaños** | Tracking con notificaciones push automáticas (Vercel cron diario a las 13:00) |
| **FamilySearch** | Registros de capacitación, tareas y anotaciones |
| **Obra Misional** | Investigadores, asignaciones, amigos para nuevos conversos, preguntas frecuentes |
| **Servicio** | Proyectos de servicio con notificaciones al consejo |
| **Chat Iglesia** | Chat con IA impulsado por DeepSeek |
| **Consejo** | Acciones del consejo, anotaciones y decisiones |
| **Reportes** | Reportes de actividad por año, generación de reporte anual (DOCX vía docxtemplater) |
| **Actividades** | Actividades registradas del quórum por año |
| **Admin** | Panel de administración: gestión de usuarios, roles, logs de auditoría, migración de datos |

---

## 🔐 Roles y Permisos

| Rol | Permiso por defecto | Descripción |
|---|---|---|
| `secretary` | Todo | Acceso total: administración, ajustes, gestión de roles y reportes |
| `president` | Todo | Acceso estratégico: todos los módulos operativos + panel de admin |
| `counselor` | Todo | Herramientas operativas para seguimiento de familias y asignaciones |
| `other` | Lectura | Solo lectura de datos del quórum |
| `user` | Lectura | Estado por defecto al registrarse. Ve la página de acceso restringido hasta que un líder le asigne un rol |

- **Aislamiento multi-tenant**: cada usuario pertenece a un barrio + organización (`barrioOrg`). Todas las consultas se limitan a ese scope.
- **Control de visibilidad**: las páginas del menú lateral se pueden ocultar por usuario desde el panel de admin.
- Las cuentas con rol `user` son redirigidas a `/no-permission` hasta que se les asigne un rol de liderazgo.

---

## 🛠️ Stack Tecnológico

| Capa | Tecnología |
|---|---|
| **Framework** | Next.js 16 (App Router, webpack) |
| **Lenguaje** | TypeScript 6.0 |
| **UI** | React 19, Tailwind CSS 3.4, Radix UI (20+ primitivos), shadcn/ui |
| **Base de datos** | Firebase Firestore |
| **Autenticación** | Firebase Auth (client + admin SDK) |
| **Funciones serverless** | Firebase Cloud Functions (Node 22) |
| **IA** | DeepSeek API (`deepseek-v4-flash`) + Google Genkit |
| **PWA** | `@ducanh2912/next-pwa` — offline, instalable, notificaciones push |
| **Notificaciones** | Web Push API + Firebase Cloud Messaging |
| **Gráficos** | Recharts |
| **Formularios** | react-hook-form + zod |
| **Exportación** | docxtemplater + docx (reportes anuales en Word) |
| **Package manager** | pnpm (workspace monorepo) |
| **Deploy** | Vercel + Firebase |

---

## 📋 Instalación

### Requisitos
- Node.js v22+
- pnpm
- Proyecto Firebase (Firestore, Auth, Storage, Functions, Cloud Messaging)
- API key de DeepSeek (opcional — para resúmenes IA y chat)

### Pasos

```bash
git clone https://github.com/AndresDevelopers/SionFlow.git
cd SionFlow
pnpm install
```

### Variables de entorno

Copiar `.env.example` a `.env.local` y completar:

```bash
# Identidad de la app (white-label)
NEXT_PUBLIC_APP_NAME="SionFlow"
NEXT_PUBLIC_APP_LOGO=""                    # opcional: ruta en /public
NEXT_PUBLIC_APP_ICON=""                    # opcional: URL completa a PNG/SVG

# Firebase
NEXT_PUBLIC_FIREBASE_API_KEY=tu_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=tu_proyecto.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=tu_proyecto
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=tu_proyecto.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=tu_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=tu_app_id
FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}

# DeepSeek (IA)
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_CHAT_MODEL=deepseek-v4-flash

# Push notifications
NEXT_PUBLIC_VAPID_PUBLIC_KEY=tu_vapid_key
```

### Arrancar en desarrollo

```bash
pnpm dev          # Next.js en puerto 9001
```

---

## 🔧 Scripts

| Comando | Descripción |
|---|---|
| `pnpm dev` | Servidor de desarrollo (puerto 9001, webpack) |
| `pnpm build` | Build de producción con inyección de config FCM |
| `pnpm start` | Servidor de producción |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Verificación de tipos (tsc --noEmit) |
| `pnpm test:roles` | Tests del sistema de roles |
| `pnpm changelog` | Generar changelog |
| `pnpm setup-hooks` | Configurar git hooks |

---

## 📁 Estructura del Proyecto

```
src/
├── app/
│   ├── (auth)/                  # login, register, forgot-password
│   ├── (main)/                  # Rutas protegidas (dashboard, members, ministering, etc.)
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
│   ├── ui/                      # shadcn/ui (auto-generados)
│   ├── dashboard/               # Widgets del dashboard
│   ├── members/                 # Componentes de miembros
│   └── shared/                  # Voice annotations, sync status, etc.
├── contexts/                    # auth-context, i18n-context
├── hooks/                       # use-members, use-permissions, etc.
├── lib/                         # firebase, collections, roles, deepseek, push, types
├── ai/flows/                    # Flujos Genkit (dashboard summary, suggestions)
└── locales/                     # es.json, en.json

functions/                       # Firebase Cloud Functions (Node 22)
├── src/index.ts                 # Reportes anuales, notificaciones, procesamiento de imágenes
└── src/modules/                 # notification-dispatcher, image-module

worker/                          # Service Worker bridge para Firebase Messaging
scripts/                         # update-fcm-config, generate-changelog, setup-hooks, migración
public/                          # PWA assets, service worker, changelog.json
```

---

## 📊 IA y Genkit

La app integra **DeepSeek** (`deepseek-v4-flash`) para:

- **Resumen inteligente del dashboard**: análisis del estado actual del quórum
- **Sugerencias de actividades y servicio**: recomendaciones basadas en datos del quórum
- **Chat Iglesia**: chat conversacional con contexto eclesiástico

Los flujos de IA usan DeepSeek como proveedor a través de `@/lib/deepseek`.

---

## 📖 Documentación

- [Arquitectura](docs/ARQUITECTURA.md)
- [Visión del proyecto](docs/VISION.md)
- [API Externa](docs/external-api.md)
- [Notificaciones Push](docs/PUSH_NOTIFICATIONS.md)
- [Chat Iglesia](docs/CHURCH_CHAT.md)
- [Dashboard Home](docs/DASHBOARD_HOME.md)
- [Sincronización de Ministración](docs/SINCRONIZACION_MINISTRACION.md)
- [Build Configuration](docs/BUILD_CONFIGURATION.md)
- [Seguridad](docs/SEGURIDAD.md)
- [Cumplimiento](docs/COMPLIANCE.md)
- [Plantilla Word Bautismos](docs/PLANTILLA_WORD_BAUTISMOS.md)
- [Instrucciones Plantilla Word](docs/INSTRUCCIONES_PLANTILLA_WORD.md)

---

## 📱 PWA

- Instalable en dispositivos móviles y escritorio
- Funciona offline con sincronización al reconectar
- Service Worker personalizado con soporte para Firebase Cloud Messaging
- Notificaciones push para cumpleaños, actividades urgentes y recordatorios

---

## 🤝 Contribuir

1. Fork del repositorio
2. Crear rama (`git checkout -b feature/nueva-funcionalidad`)
3. Commit (`git commit -m 'Add: descripción'`)
4. Push (`git push origin feature/nueva-funcionalidad`)
5. Abrir Pull Request

Ver [CONTRIBUTING.md](CONTRIBUTING.md) para estándares de código.

---

## 📄 Licencia

MIT — ver [LICENSE](LICENSE).

---

<div align="center">
  <p>Desarrollado con ❤️ para apoyar la obra del quórum</p>
</div>
