# 🕊️ SionFlow — Sistema de Gestión para la Presidencia del Quórum y la Sociedad de Socorro

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

Aplicación web moderna (PWA) diseñada para las **presidencias del Quórum de Élderes y la Sociedad de Socorro** — presidente, consejeros y secretario — en la Iglesia de Jesucristo de los Santos de los Últimos Días. Digitaliza y centraliza las responsabilidades administrativas y pastorales de ambas organizaciones.

> **Licencia AGPL-3.0**: Este proyecto está licenciado bajo la [GNU Affero General Public License v3.0 o posterior](LICENSE) (AGPL-3.0-or-later). Cualquier uso del software como servicio (SaaS/web), modificado o no, **obliga a publicar el código fuente correspondiente** conforme a la [sección 13 de AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html#section13). Ver también [NOTICE](NOTICE).

> **White-label + multi-organización**: El nombre, logo e ícono de la app son configurables mediante variables de entorno (`NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_LOGO`, `NEXT_PUBLIC_APP_ICON`). La app soporta múltiples organizaciones por barrio (Quórum de Élderes, Sociedad de Socorro, etc.) con datos aislados por `barrioOrg`. "SionFlow" es el nombre por defecto en este repositorio.

> **Aviso**: Esta aplicación **no es oficial** de La Iglesia de Jesucristo de los Santos de los Últimos Días. Es una herramienta de apoyo para líderes en sus llamamientos.

### Contenido

1. [Cómo ayuda a las presidencias](#cómo-ayuda-a-las-presidencias)
2. [Quién usa qué (por rol)](#quién-usa-qué-por-rol)
3. [Flujos de trabajo recomendados](#flujos-de-trabajo-recomendados)
4. [Páginas de la aplicación](#páginas-de-la-aplicación)
5. [Roles y permisos](#roles-y-permisos)
6. [Stack, instalación y desarrollo](#stack-tecnológico)

Visión de producto ampliada: [`docs/VISION.md`](docs/VISION.md).

---

## Cómo ayuda a las presidencias

Las presidencias del Quórum de Élderes y de la Sociedad de Socorro deben cuidar a los miembros, coordinar la ministración, seguir a conversos e investigadores, planificar servicio y actividades, y preparar el consejo de la organización — a menudo con información dispersa en hojas, chats y memoria.

SionFlow concentra esa operación en un solo lugar, con alcance por **barrio + organización**:

| Necesidad de la presidencia | Cómo lo resuelve SionFlow |
|---|---|
| Ver el estado de la organización de un vistazo | Dashboard con KPIs, miembros por estado, actividades próximas y cumpleaños |
| Llevar el padrón y el cuidado pastoral | Miembros con estados (activo / menos activo / inactivo / fallecido), ordenanzas y asignaciones |
| Detectar quién necesita atención especial | Observaciones: lagunas de ordenanzas/sacerdocio/ministración, salud y foco familiar |
| Fortalecer a los conversos recientes | Seguimiento 24 meses, amigos, maestros ministrantes y alertas de menos activos |
| Organizar la ministración | Compañerismos, distritos, familias asignadas, urgencias y sync bidireccional |
| Coordinar la obra misional | Investigadores, asignaciones, futuros bautismos, amigos de nuevos conversos |
| Preparar y ejecutar el consejo | Página Consejo: acciones, urgentes, inactivos, servicios, bautismos y anotaciones |
| No olvidar fechas clave | Cumpleaños con notificaciones push (cron diario) |
| Planificar servicio y actividades | Registro por año, sugerencias con IA, transferencia servicio ↔ actividad |
| Capacitar en historia familiar | FamilySearch: capacitaciones, tareas y notas |
| Consultar deberes y recursos | Chat Iglesia con IA (DeepSeek + visión con Gemini) |
| Administrar el acceso del equipo | Roles, permisos, visibilidad de páginas y bitácora de auditoría |

### Antes y después

| Sin SionFlow | Con SionFlow |
|---|---|
| El secretario arma un Excel o WhatsApp antes de cada consejo | La presidencia abre **Consejo** y ve la agenda consolidada |
| Cada consejero “recuerda” a sus familias urgentes | Las urgencias se marcan una vez y llegan a todos con rol de liderazgo |
| Conversos se pierden tras el bautismo | Lista de 24 meses con amigos, maestros y alertas de actividad |
| Padrón y ministración no coinciden | Sync bidireccional miembros ↔ compañerismos |
| Cumpleaños en una hoja olvidada | Push automático el día del cumpleaños |
| Ideas de servicio/actividad en blanco | Sugerencias con IA + historial del año |
| Cuentas nuevas ven datos sin control | Rol `user` bloqueado hasta asignación de rol |

### Qué **no** intenta ser

- No es un sistema oficial de la Iglesia ni sustituye LCR u otras herramientas corporativas.
- No gestiona finanzas del barrio ni el obispado como producto principal.
- No toma decisiones doctrinales: **apoya** a la presidencia; no habla en nombre de la Iglesia.
- No mezcla datos entre barrios u organizaciones: el aislamiento por `barrioOrg` es intencional.

---

## Quién usa qué (por rol)

| Rol | Páginas que más usa | Responsabilidad típica en la app |
|---|---|---|
| **Presidente** | Dashboard, Consejo, Observaciones, Conversos, Chat Iglesia | Priorizar, decidir en el consejo, ver el panorama pastoral |
| **Consejero** | Ministración, Conversos, Obra misional, Servicio, FamilySearch, Miembros | Ejecutar seguimiento semanal y actualizar estados/asignaciones |
| **Secretario** | Miembros, Ministración, Admin (usuarios/auditoría), Cumpleaños, Actividades | Calidad de datos, alta de usuarios, coherencia del padrón |
| **Other** | Lectura de módulos visibles | Consulta sin editar |
| **User** | `/no-permission` | Espera asignación de rol |

---

## Flujos de trabajo recomendados

### A. Consejo semanal de la organización

1. **Durante la semana**: cada líder anota en Dashboard o marca urgentes en Ministración/Miembros.
2. **Antes del consejo**: abrir **Consejo** (`/council`).
3. **Orden sugerido de revisión**:
   - Anotaciones / acciones del consejo
   - Miembros y familias urgentes
   - Conversos recientes (especialmente menos activos)
   - Menos activos e inactivos
   - Bautismos (próximos 7 días)
   - Servicios y actividades próximas
   - Fallecidos con obra vicaria pendiente
4. **Cierre**: resolver anotaciones, asignar responsables y actualizar estados en Miembros si cambió la situación.

### B. Fortalecer a un converso nuevo

1. Registrar o editar el miembro con **fecha de bautismo** en **Miembros**.
2. Verificar que aparece en **Conversos** (ventana de 24 meses).
3. Asignar **amigos** y alinear **maestros ministrantes** (Conversos u Obra misional).
4. Revisar en el consejo si aparece como menos activo/inactivo.
5. Usar **Observaciones** si faltan ordenanzas, investidura o asignación de ministración.

### C. Reorganizar la ministración

1. En **Ministración**, crear o editar **distritos** y **compañerismos**.
2. Asignar familias a cada pareja; revisar el detalle en `/ministering/[id]`.
3. Confirmar que los maestros se reflejan en las fichas de **Miembros** (sync).
4. Si una familia necesita atención inmediata: marcar **urgente** → llega al consejo y por notificación.

### D. Coordinar un bautismo

1. En **Obra misional → Futuros miembros**, registrar nombre y fecha de bautismo (y foto si aplica).
2. Verificar el KPI en **Dashboard** y la lista de bautismos en **Consejo**.
3. El día del bautismo (o después): marcar como bautizado y asegurar el alta en **Miembros**.
4. Continuar el flujo **B** (conversos + amigos).

### E. Planificar servicio y actividades del mes

1. Revisar **Servicio** y **Actividades** del año en curso.
2. Usar **sugerencias con IA** si la presidencia necesita ideas.
3. Registrar fecha, descripción e imágenes.
4. Si un servicio se convierte en actividad social de la organización (o al revés), usar la **transferencia** entre módulos.
5. Confirmar que aparecen en el resumen del Dashboard y en la agenda del Consejo.

### F. Incorporar a un nuevo líder de la presidencia

1. La persona se registra en `/register` (queda como `user`).
2. El **secretario** en `/admin/users` le asigna rol (`president`, `counselor` o `secretary`) y permiso.
3. Opcionalmente limita **visibilidad** de páginas del menú.
4. El nuevo líder completa **Perfil** y **Ajustes** (idioma, notificaciones, contraseña).

---

## Páginas de la aplicación

Guía de cada pantalla: **qué hace**, **cómo ayuda a la presidencia** y **ejemplo de uso**.

### Menú principal (navegación lateral)

#### 1. Dashboard (`/`)

**Qué hace**

- KPIs clicables: conversos recientes, futuros miembros, acciones del consejo.
- **Resumen de actividades**: total del año, próximas 14 días, próxima y última actividad.
- **Miembros por estado**: activos, menos activos, inactivos y total.
- **Fallecidos** con checklist de ordenanzas del templo (obra vicaria pendiente).
- **Cumpleaños** de hoy y de los próximos 14 días.
- **Anotaciones** (texto o voz) que pueden marcarse para el consejo.

**Cómo ayuda:** es el “tablero de mando” al abrir la app: prioriza la semana sin saltar entre módulos.

**Ejemplo:** el domingo por la mañana el presidente ve 2 bautismos próximos, 1 familia urgente y 3 cumpleaños de la semana → ya tiene el esqueleto del consejo.

#### 2. Miembros (`/members`, `/members/[id]`)

**Qué hace**

- Alta, edición y baja lógica del padrón de la organización.
- Datos de contacto, foto, fechas (nacimiento, bautismo), estado, ordenanzas, maestros ministrantes, notas.
- Búsqueda y filtros por estado; ficha individual con historial relevante.
- Integración con conversos (fecha de bautismo) y ministración (asignaciones).

**Cómo ayuda:** es la **fuente de verdad** del quórum o de la Sociedad de Socorro. Todo lo demás (conversos, consejo, observaciones) se apoya en este padrón.

**Ejemplo:** un consejero marca a un hermano como “menos activo” tras varias visitas fallidas; al instante impacta Dashboard, Observaciones y Consejo.

#### 3. Observaciones (`/observations`)

**Qué hace**

Panel de atención especial con indicadores calculados, entre otros:

| Indicador | Para qué sirve en la presidencia |
|---|---|
| Sin investidura / ordenanzas pendientes | Priorizar preparación del templo |
| Sin oficio de élder / sin sacerdocio mayor | Enfoque de progreso del sacerdocio (QE) |
| Sin ministración | Nadie asignado a cuidar a esa persona/familia |
| Conversos inactivos / miembros inactivos | Recuperación y retención |
| Foco familiar | Familias que requieren plan conjunto |
| Compañerismos problemáticos | Revisar parejas de ministración |
| Preocupaciones de salud | Helpers, fotos, seguimiento de cuidado temporal |

**Cómo ayuda:** responde “¿a quién debemos mirar esta semana?” con datos, no solo con impresiones.

**Ejemplo:** el consejero de ministración abre Observaciones y ve 5 miembros sin asignación → reorganiza en Ministración el mismo día.

#### 4. Conversos (`/converts`)

**Qué hace**

- Lista automática de miembros bautizados en los **últimos 24 meses** (no es un padrón paralelo: se deriva de Miembros).
- Alertas visuales de **menos activo** e **inactivo**.
- Ficha de información del converso, asignación de **amigos** y **maestros ministrantes**.
- Alta/edición reutilizando el formulario de miembros.

**Cómo ayuda:** materializa el mandato de fortalecer a los conversos: amistad, ministración y seguimiento de retención en un solo listado.

**Ejemplo:** en el consejo revisan solo los conversos con alerta roja/amarilla y asignan un amigo adicional esa misma reunión.

#### 5. Ministración (`/ministering`)

**Qué hace**

- **Compañerismos** (parejas), **distritos**, familias asignadas.
- Notas / seguimiento por compañerismo (`/ministering/[id]`).
- Marcar **necesidad urgente** de una familia → notifica y alimenta Consejo.
- Herramientas de sync/migración de maestros ministrantes (coherencia con Miembros).
- Ruta de urgentes: `/ministering/urgent`.

**Cómo ayuda:** convierte la ministración en un sistema vivo: se reorganiza, se audita y se escala lo urgente sin depender de un solo líder.

**Ejemplo:** se reasigna una familia a un nuevo compañerismo; el nombre de los maestros se actualiza en la ficha del miembro sin doble carga manual.

#### 6. Cumpleaños (`/birthdays`)

**Qué hace**

- Registro de cumpleaños (manual o ligado a miembros).
- Listado y edición (`/birthdays/[id]/edit`).
- **Notificaciones push** automáticas (cron diario en Vercel, ~13:00).

**Cómo ayuda:** el contacto personal (un mensaje, una visita breve) es pastoral y simple; la app evita que se olvide.

**Ejemplo:** el secretario recibe el push del día y avisa al compañerismo de ministración para que salude a la familia.

#### 7. FamilySearch (`/family-search`)

**Qué hace**

- Registro de **capacitaciones** a familias (quién ya recibió ayuda).
- **Tareas** de historia familiar pendientes o en curso.
- **Anotaciones** (texto/voz) y FAQ de apoyo.

**Cómo ayuda:** da trazabilidad al trabajo de historia familiar/templo a nivel de organización: no se capacita dos veces a la misma familia ni se pierde el seguimiento.

**Ejemplo:** un consejero filtra familias sin capacitación y programa 3 visitas del mes con tarea registrada.

#### 8. Obra misional (`/missionary-work`)

**Qué hace** — módulo con pestañas:

| Pestaña | Contenido | Uso en la presidencia |
|---|---|---|
| **Asignaciones** | Tareas misionales de la organización | Quién hace qué con los misioneros / referencias |
| **Investigadores** | Personas en proceso, misioneros a cargo, vínculo al bautismo | Correlación misional |
| **Imágenes** | Fotos de obra misional (descripción con IA de visión) | Memoria y reportes visuales |
| **Nuevos conversos** | Amigos y apoyo post-bautismal | Puente con el módulo Conversos |
| **Futuros miembros** | Fechas de bautismo, marcar bautizado, fotos | Calendario de bautismos |

> La ruta legacy `/future-members` redirige a `/missionary-work?tab=future_members`.

**Cómo ayuda:** alinea a la presidencia con los misioneros de tiempo completo y el plan de bautismos en un solo módulo.

**Ejemplo:** el jueves revisan “Futuros miembros” y confirman quién del quórum/SS asistirá al bautismo del sábado; el lunes marcan bautizado y asignan amigos.

#### 9. Servicio (`/service`)

**Qué hace**

- Proyectos de servicio del año y **próximos** a corto plazo.
- Imágenes, alta (`/service/add`) y edición (`/service/[id]/edit`).
- **Sugerencias con IA** (cuidado del quórum/SS e impacto comunitario).
- Transferencia servicio → actividad cuando el evento cambia de naturaleza.

**Cómo ayuda:** planifica el servicio cristiano y deja historial usable para el consejo y la revisión anual.

**Ejemplo:** la presidencia pide sugerencias de IA, elige “ayuda a familia con mudanza”, registra fecha y notifica en el consejo.

#### 10. Chat Iglesia (`/church-chat`)

**Qué hace**

- Chat con **DeepSeek** sobre llamamientos, deberes y recursos eclesiásticos.
- Imagen adjunta (visión **Gemini**), voz, copiar respuestas e historial.

**Cómo ayuda:** orienta a líderes nuevos o con dudas sobre el “por qué” del llamamiento. **No** decide sobre datos del barrio ni sustituye a la presidencia.

**Ejemplo:** un consejero nuevo pregunta “¿qué responsabilidades tiene el primer consejero del quórum?” y obtiene una explicación orientativa antes de la entrevista con el presidente.

#### 11. Consejo (`/council`)

**Qué hace** — mesa de trabajo unificada:

| Bloque | Contenido |
|---|---|
| Anotaciones del consejo | Notas de la semana a resolver |
| Servicios próximos | Próximos 7 días + futuros; marcar notificado |
| Miembros urgentes | Marcados en el padrón como prioritarios |
| Urgencias de ministración | Familias reportadas desde Ministración |
| Conversos | Seguimiento reciente para el consejo |
| Menos activos / inactivos | Listas de recuperación |
| Bautismos (7 días) | Futuros miembros con fecha cercana |
| Actividades (14 días) | Eventos que requieren coordinación |
| Fallecidos | Obra vicaria del templo pendiente |

> `/consejo` redirige a `/council` (enlaces y notificaciones antiguas).

**Cómo ayuda:** es **la página de la reunión de la presidencia**. Reduce el tiempo de juntar información y enfoca la agenda en personas y acciones.

**Ejemplo:** la reunión entera se conduce con la app en el proyector o en el celular del secretario; al final no quedan “puntos sueltos” sin dueño.

#### 12. Actividades (`/reports/activities`)

**Qué hace**

- Actividades registradas **por año**, con fotos y detalle.
- Sugerencias con IA, alta y edición (`/reports/add`, `/reports/[id]/edit`).
- Transferencia hacia/desde **Servicio**.

**Cómo ayuda:** documenta la vida de la organización (actividades del quórum o de la Sociedad de Socorro) y alimenta Dashboard y Consejo.

**Ejemplo:** al cerrar el año exportan mentalmente el historial: cuántas actividades hubo, cuándo fue la última y qué falta planificar para el trimestre.

---

### Páginas de cuenta, administración y soporte

| Página | Ruta | Qué hace | Cómo ayuda a la presidencia |
|---|---|---|---|
| **Perfil** | `/profile` | Nombre, foto, vínculo a ficha de miembro | Cada líder se identifica y puede enlazarse al padrón |
| **Ajustes** | `/settings` | Tema, idioma, email/contraseña, preferencias | Uso cómodo y cuenta segura |
| **Administración** | `/admin` | Stats del tenant y accesos a submódulos | El secretario gobierna el sistema sin tocar Firebase a mano |
| **Usuarios** | `/admin/users` | Roles, permisos, visibilidad de menú, cupos, borrar usuarios | Solo la presidencia correcta ve/edita lo necesario |
| **Auditoría** | `/admin/audit` | Bitácora de cambios admin (roles, permisos, miembros…) | Trazabilidad si algo se cambió por error |
| **Migración** | `/admin/migrate` | Asigna `barrioOrg` a docs legacy | Activa multi-barrio sin perder datos viejos |
| **Seed** | `/admin/seed` | Siembra barrios/organizaciones del registro | Altas de usuarios con barrio/org correctos |
| **Donar** | `/donate` | Enlace/QR voluntario de apoyo a costos | Sostenibilidad opcional de la herramienta |
| **Login / Registro / Recuperar** | `/login`, `/register`, `/forgot-password` | Acceso y alta | Entrada controlada al tenant |
| **Sin permiso** | `/no-permission` | Bloqueo para rol `user` | Evita fugas de datos a cuentas sin rol |
| **Offline** | `/~offline` | Fallback PWA | Continuidad básica sin red |
| **App Admin (plataforma)** | `/app-admin/*` | Super-admin global | Operación multi-tenant del producto (no de un barrio) |

---

## Resumen rápido de módulos

| Módulo | Qué hace | Página clave |
|---|---|---|
| **Dashboard** | KPIs, actividades, cumpleaños, fallecidos, anotaciones | `/` |
| **Miembros** | Padrón, estados, ordenanzas, asignaciones | `/members` |
| **Observaciones** | Indicadores de atención + salud | `/observations` |
| **Conversos** | 24 meses, amigos, maestros, alertas | `/converts` |
| **Ministración** | Compañerismos, distritos, urgencias, sync | `/ministering` |
| **Cumpleaños** | Tracking + push diario | `/birthdays` |
| **FamilySearch** | Capacitaciones, tareas, notas | `/family-search` |
| **Obra misional** | Investigadores, bautismos, amigos, imágenes | `/missionary-work` |
| **Servicio** | Proyectos, IA, transferencia a actividades | `/service` |
| **Chat Iglesia** | IA DeepSeek + visión Gemini | `/church-chat` |
| **Consejo** | Agenda consolidada de la presidencia | `/council` |
| **Actividades** | Registro anual de la organización | `/reports/activities` |
| **Admin** | Usuarios, roles, auditoría, migración | `/admin` |

---

## Roles y permisos

| Rol | Permiso por defecto | Descripción |
|---|---|---|
| `secretary` | Todo | Acceso total: administración, ajustes y gestión de roles |
| `president` | Todo | Acceso estratégico: módulos operativos + panel de admin según configuración |
| `counselor` | Todo | Herramientas operativas para seguimiento de familias y asignaciones |
| `other` | Lectura | Solo lectura de datos de tu organización |
| `user` | Lectura | Estado por defecto al registrarse. Ve `/no-permission` hasta que un líder le asigne un rol |

- **Aislamiento multi-tenant**: cada usuario pertenece a un barrio + organización (`barrioOrg`). Consultas, reglas Firestore, APIs y notificaciones se limitan a ese scope (detalle en [`docs/SEGURIDAD.md`](docs/SEGURIDAD.md) y checklist en [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md)).
- **Control de visibilidad**: las páginas del menú lateral se pueden ocultar por usuario desde el panel de admin.
- Las cuentas con rol `user` son redirigidas a `/no-permission` hasta que se les asigne un rol de liderazgo.
- **Permisos**: `all` (escribir) y `read` (solo lectura). Un consejero puede quedar en lectura si el secretario lo configura así.

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| **Framework** | Next.js 16 (App Router, webpack) |
| **Lenguaje** | TypeScript 6 |
| **UI** | React 19, Tailwind CSS 3.4, Radix UI, shadcn/ui |
| **Base de datos** | Firebase Firestore |
| **Autenticación** | Firebase Auth (client + admin SDK) |
| **Funciones serverless** | Firebase Cloud Functions (Node 22) |
| **IA** | DeepSeek (todo en texto) + Gemini (solo imágenes) |
| **PWA** | `@ducanh2912/next-pwa` — offline, instalable, notificaciones push |
| **Notificaciones** | Web Push API + Firebase Cloud Messaging |
| **Gráficos** | Recharts |
| **Formularios** | react-hook-form + zod |
| **Package manager** | pnpm (workspace monorepo) |
| **Deploy** | Vercel + Firebase |

---

## Instalación

### Requisitos
- Node.js v22+
- pnpm
- Proyecto Firebase (Firestore, Auth, Storage, Functions, Cloud Messaging)
- API key de **DeepSeek** (opcional) — IA de **todo** el sistema en texto (dashboard, sugerencias, chat, etc.)
- API key de **Gemini** (opcional) — IA **solo para imágenes** (descripciones automáticas; DeepSeek no ve fotos)

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

# DeepSeek = IA de TODO (texto): dashboard, sugerencias, chat, resúmenes…
# https://platform.deepseek.com/api_keys
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_CHAT_MODEL=deepseek-v4-flash

# Gemini = IA SOLO para IMÁGENES (Obra misional + imagen en chat)
# No reemplaza a DeepSeek. Gratis: https://aistudio.google.com/apikey
GEMINI_API_KEY=...

# Push notifications
NEXT_PUBLIC_VAPID_PUBLIC_KEY=tu_vapid_key
```

### Arrancar en desarrollo

```bash
pnpm dev          # Next.js en puerto 9001
```

---

## Scripts

| Comando | Descripción |
|---|---|
| `pnpm dev` | Servidor de desarrollo (puerto 9001, webpack) |
| `pnpm build` | Build de producción con inyección de config FCM |
| `pnpm start` | Servidor de producción |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Verificación de tipos (`tsc --noEmit`) |
| `pnpm test:roles` | Tests del sistema de roles |
| `pnpm check:i18n` | Verifica claves de i18n entre `es.json` y `en.json` |
| `pnpm changelog` | Generar changelog |
| `pnpm setup-hooks` | Configurar git hooks |
| `pnpm firebase:use:prod` | Seleccionar proyecto Firebase de producción |
| `pnpm firebase:use:dev` | Seleccionar proyecto Firebase de desarrollo |

---

## Estructura del proyecto

```
src/
├── app/
│   ├── (auth)/                  # login, register, forgot-password
│   ├── (main)/                  # Rutas protegidas
│   │   ├── admin/               # Panel de administración
│   │   ├── birthdays/           # Cumpleaños
│   │   ├── church-chat/         # Chat con IA
│   │   ├── converts/            # Conversos recientes
│   │   ├── council/             # Consejo ( /consejo redirige aquí )
│   │   ├── donate/              # Donaciones
│   │   ├── family-search/       # FamilySearch
│   │   ├── future-members/      # Redirect → obra misional (tab)
│   │   ├── members/             # Miembros
│   │   ├── ministering/         # Ministración
│   │   ├── missionary-work/     # Obra misional (+ futuros miembros)
│   │   ├── observations/        # Observaciones de salud y atención
│   │   ├── profile/             # Perfil de usuario
│   │   ├── reports/             # Actividades
│   │   ├── service/             # Servicio
│   │   └── settings/            # Ajustes
│   ├── (platform-admin)/        # App-admin de plataforma
│   ├── api/                     # API routes + cron endpoints
│   └── manifest/                # PWA manifest
├── components/                  # UI, dashboard, members, shared, offline…
├── contexts/                    # auth, i18n, members, refresh
├── hooks/                       # permisos, offline, members local…
├── lib/                         # firebase, roles, deepseek, push, types…
├── ai/flows/                    # Sugerencias de actividades y servicio
└── locales/                     # es.json, en.json

functions/                       # Firebase Cloud Functions (Node 22)
worker/                          # Service Worker bridge para FCM
scripts/                         # FCM config, changelog, hooks, tests
public/                          # PWA assets, service worker, changelog
docs/                            # Documentación técnica
```

---

## IA

| Variable | Proveedor | Para qué es |
|---|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek | **Todo** lo de IA en **texto**: sugerencias de actividades/servicio, Chat Iglesia, reescrituras. Es la IA principal de la app. |
| `GEMINI_API_KEY` | Gemini | **Solo imágenes**: descripción automática al subir fotos (obra misional) y entender una imagen adjunta en el Chat Iglesia. |

DeepSeek no acepta fotos en su API de chat; por eso la visión va aparte con Gemini.

- Texto → `@/lib/deepseek` (`DEEPSEEK_API_KEY`)
- Imágenes → `@/lib/vision` (`GEMINI_API_KEY`)

---

## Documentación

- [Arquitectura](docs/ARQUITECTURA.md)
- [Visión del proyecto](docs/VISION.md)
- [API](docs/API.md)
- [API Externa](docs/external-api.md)
- [Notificaciones Push](docs/PUSH_NOTIFICATIONS.md)
- [Chat Iglesia](docs/CHURCH_CHAT.md)
- [Dashboard Home](docs/DASHBOARD_HOME.md)
- [Sincronización de Ministración](docs/SINCRONIZACION_MINISTRACION.md)
- [Sincronización de datos en la nube](docs/DATA_SYNC_CLOUD.md)
- [Build Configuration](docs/BUILD_CONFIGURATION.md)
- [Seguridad](docs/SEGURIDAD.md)
- [Cumplimiento](docs/COMPLIANCE.md)
- [Auditoría de seguridad](SECURITY_AUDIT.md)

---

## PWA

- Instalable en dispositivos móviles y escritorio
- Funciona offline con sincronización al reconectar
- Service Worker personalizado con soporte para Firebase Cloud Messaging
- Notificaciones push para cumpleaños, actividades urgentes y recordatorios

---

## Contribuir

1. Fork del repositorio
2. Crear rama (`git checkout -b feature/nueva-funcionalidad`)
3. Commit (`git commit -m 'Add: descripción'`)
4. Push (`git push origin feature/nueva-funcionalidad`)
5. Abrir Pull Request

Ver [CONTRIBUTING.md](CONTRIBUTING.md) para estándares de código.

---

## Licencia

**AGPL-3.0-or-later** — ver [LICENSE](LICENSE) y [NOTICE](NOTICE).

Copyright (C) 2025 AndresDevelopers

Este software se distribuye bajo la GNU Affero General Public License v3.0 o, a tu opción, cualquier versión posterior. Si lo ejecutas como servicio de red (SaaS, aplicación web u otro acceso remoto), la sección 13 de AGPL-3.0 exige ofrecer a los usuarios el código fuente correspondiente de la versión que estén usando.

---

<div align="center">
  <p>Desarrollado con ❤️ para apoyar a las presidencias del Quórum de Élderes y la Sociedad de Socorro</p>
</div>
