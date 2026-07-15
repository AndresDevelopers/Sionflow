# Visión del Proyecto

## Propósito

**SionFlow** es un sistema de gestión integral para las **presidencias del Quórum de Élderes y la Sociedad de Socorro**: presidente, consejeros y secretario. No reemplaza las herramientas oficiales de la Iglesia ni la dirección del Espíritu; **apoya el llamamiento** al digitalizar el trabajo operativo que hoy suele vivir en hojas sueltas, chats de grupo y memoria de cada líder.

La aplicación **no es oficial** de La Iglesia de Jesucristo de los Santos de los Últimos Días. Está pensada exclusivamente como herramienta de apoyo pastoral y administrativo a nivel de **organización dentro de un barrio**.

---

## Problema que resuelve

Una presidencia típica debe, de forma continua:

1. Conocer el estado de los miembros (activos, menos activos, inactivos, fallecidos).
2. Organizar y revisar la **ministración** (compañerismos, distritos, familias, urgencias).
3. Fortalecer a **conversos recientes** (amigos, maestros, retención a 24 meses).
4. Coordinar la **obra misional** (investigadores, fechas de bautismo, post-bautismo).
5. Planificar **servicio** y **actividades** de la organización.
6. Preparar y ejecutar el **consejo** de la organización con agenda clara.
7. Dar seguimiento a **historia familiar / FamilySearch** y a la **obra vicaria**.
8. Recordar **cumpleaños** y gestos de cuidado personal.
9. Gestionar **quién de la presidencia** puede ver o editar qué.

Sin un sistema compartido, cada reunión de consejo se vuelve un reensamblaje de datos: “¿quién está menos activo?”, “¿quién se bautiza esta semana?”, “¿qué servicio quedó pendiente?”. SionFlow concentra esas respuestas en un solo lugar, **aislado por barrio + organización** (`barrioOrg`).

---

## Objetivos principales

| Objetivo | Resultado esperado |
|---|---|
| Gestionar el padrón a nivel de presidencia | Miembros con estados, ordenanzas, contactos y asignaciones actualizados |
| Facilitar planificación y seguimiento | Ministración, consejos, servicio y actividades en un flujo continuo |
| Mantener consistencia de asignaciones | Sync bidireccional miembros ↔ compañerismos de ministración |
| Alertar a tiempo | Push y listas de urgentes, cumpleaños, bautismos y acciones del consejo |
| Apoyar decisiones del consejo | Vista consolidada de personas y tareas prioritarias |
| Acompañar el cuidado espiritual | Observaciones, salud, conversos, menos activos, obra del templo |
| Ser usable en el terreno | PWA instalable, offline parcial, i18n (es/en), roles claros |
| Proteger los datos del barrio | Multi-tenant por `barrioOrg`, RBAC, auditoría administrativa |

---

## Cómo ayuda a cada rol de la presidencia

### Presidente
- **Dashboard y Consejo** como tablero de mando: ve prioridades sin pedir un reporte manual a cada consejero.
- Decide en el consejo con listas de urgentes, conversos, inactivos, servicios y bautismos próximos.
- Usa **Observaciones** para enfocar el cuidado (ordenanzas, sacerdocio, ministración, salud).
- Consulta el **Chat Iglesia** cuando necesita claridad sobre deberes del llamamiento.

### Consejeros
- Operan **Ministración**, **Conversos**, **Obra misional** y **Servicio** día a día.
- Marcan familias o miembros urgentes y confían en que el consejo lo verá.
- Registran capacitaciones **FamilySearch** y el progreso de tareas familiares.
- Actualizan estados de miembros y notas tras visitas o contactos.

### Secretario
- Mantiene la **calidad de los datos** (miembros, fechas, fotos, estados).
- Administra **usuarios, roles, permisos y visibilidad** del menú (`/admin`).
- Revisa la **bitácora de auditoría** ante cambios sensibles.
- Ejecuta migraciones de `barrioOrg` si hay datos legacy.
- Coordina que el padrón y la ministración estén sincronizados.

### Other (solo lectura)
- Puede consultar información de la organización sin modificar registros.
- Útil para líderes de apoyo o transición controlada de acceso.

### User (recién registrado)
- Queda en `/no-permission` hasta que el secretario asigne un rol de liderazgo.
- Evita que cuentas nuevas vean o editen datos de la organización por defecto.

---

## Mapa de páginas y valor pastoral

| Página | Ruta | Valor para la presidencia |
|---|---|---|
| Dashboard | `/` | Panorama semanal: KPIs, actividades, cumpleaños, fallecidos, anotaciones |
| Miembros | `/members` | Padrón vivo: contactar, filtrar por estado, revisar ordenanzas |
| Observaciones | `/observations` | “¿A quién debemos mirar esta semana?” (indicadores + salud) |
| Conversos | `/converts` | Retención 24 meses, amigos y maestros ministrantes |
| Ministración | `/ministering` | Compañerismos, distritos, familias, urgencias |
| Cumpleaños | `/birthdays` | Recordatorios y push para el contacto personal |
| FamilySearch | `/family-search` | Capacitaciones y tareas de historia familiar |
| Obra misional | `/missionary-work` | Investigadores, bautismos, amigos, imágenes, asignaciones |
| Servicio | `/service` | Proyectos de servicio e historial del año |
| Chat Iglesia | `/church-chat` | Orientación sobre llamamientos y recursos |
| Consejo | `/council` | Agenda unificada de la reunión de la presidencia |
| Actividades | `/reports/activities` | Calendario y registro de la vida de la organización |
| Admin | `/admin/*` | Gobernanza del sistema de la organización |
| Perfil / Ajustes | `/profile`, `/settings` | Identidad, idioma, tema y seguridad de cada líder |

Detalle de pantallas y subrutas: ver el [README principal](../README.md#páginas-de-la-aplicación).

---

## Flujos de trabajo que la visión prioriza

### 1. Preparar y conducir el consejo de la organización
1. Cada líder registra anotaciones o marca urgentes durante la semana (Dashboard, Ministración, Miembros).
2. Antes del consejo, la presidencia abre **Consejo** (`/council`).
3. Revisan en orden: urgentes → conversos → menos activos/inactivos → bautismos → servicios → actividades → obra vicaria.
4. Resuelven o dejan acciones con responsables; las anotaciones se marcan como resueltas.

### 2. Alta y seguimiento de un converso
1. Se registra o actualiza el miembro con **fecha de bautismo** en Miembros.
2. Aparece automáticamente en **Conversos** (ventana de 24 meses).
3. Se asignan **amigos** y se alinean **maestros ministrantes** (también desde Obra misional).
4. Si baja la actividad, las alertas de menos activo/inactivo se ven en Conversos y Consejo.

### 3. Reorganizar la ministración
1. Secretario o consejero edita compañerismos y distritos.
2. La sincronización mantiene coherencia con los maestros en las fichas de miembros.
3. Familias con necesidad inmediata se marcan urgentes → notificación y lista en Consejo.

### 4. Coordinar un bautismo próximo
1. Futuro miembro en **Obra misional → Futuros miembros** (fecha de bautismo).
2. Aparece en el dashboard (KPI) y en Consejo (próximos 7 días).
3. Tras el bautismo se marca bautizado; el miembro pasa al padrón y al seguimiento de conversos.

### 5. Plan anual de servicio y actividades
1. Se registran proyectos de servicio y actividades por año.
2. La IA sugiere ideas cuando la presidencia necesita inspiración práctica.
3. Un servicio puede transferirse a actividad (o viceversa) según el tipo de evento.
4. El dashboard resume el año y las próximas dos semanas.

---

## Alcance (en producto)

**Incluye**
- Gestión de miembros con indicadores relevantes para la presidencia
- Ministración (compañerismos, distritos, urgencias, sync)
- Conversos, obra misional, futuros miembros
- Observaciones y preocupaciones de salud
- Servicio, actividades, FamilySearch, cumpleaños
- Consejo consolidado y anotaciones (texto/voz)
- Chat con IA (DeepSeek) y visión de imágenes (Gemini)
- Notificaciones push (cumpleaños, urgencias, recordatorios)
- Multi-organización con aislamiento por `barrioOrg`
- RBAC, visibilidad de menú, auditoría administrativa
- PWA (instalable, offline parcial)

**No incluye (límites intencionales)**
- Sustituir sistemas oficiales de la Iglesia (LCR, herramientas corporativas, etc.)
- Contabilidad de ofrendas o finanzas del barrio
- Gestión del obispado o del estaca como producto principal
- Automatizar juicios doctrinales o decisiones de disciplina
- Compartir datos entre barrios u organizaciones distintas (aislamiento multi-tenant)

---

## Principios de diseño

1. **La persona primero**: cada lista termina en un nombre, un contacto o una acción pastoral.
2. **Un solo lugar de verdad por organización**: el padrón alimenta conversos, ministración y consejo.
3. **Consejo accionable**: menos gráficos decorativos; más “qué hay que hacer esta semana”.
4. **Fallar cerrado en seguridad**: sin `barrioOrg` no hay listados cruzados entre tenants.
5. **Roles claros**: quien se registra no ve datos hasta que la presidencia le da un rol.
6. **Apoyo, no autoridad**: la app ayuda a la presidencia; no habla en nombre de la Iglesia.
7. **Usable en el celular del líder**: PWA, notificaciones y flujos cortos en visita o entre reuniones.

---

## Stakeholders

| Stakeholder | Interés principal |
|---|---|
| Secretario | Datos limpios, usuarios, roles, auditoría |
| Presidente | Visión global, agenda del consejo, prioridades pastorales |
| Consejeros | Ejecución de ministración, conversos, misional, servicio |
| Other | Consulta sin riesgo de edición accidental |
| Operador de plataforma (`app-admin`) | Multi-tenant global, no un barrio concreto |
| Miembros del quórum / SS (indirectos) | Mejor cuidado, menos olvidos, mejor coordinación de la presidencia |

---

## Métricas de éxito (visión de producto)

- La presidencia prepara el consejo en **minutos**, no reensamblando hojas.
- Menos conversos “caen del radar” en los primeros 24 meses.
- Las urgencias de ministración llegan a **toda la presidencia**, no solo a quien las detectó.
- El padrón y los compañerismos **no se contradicen**.
- Cada líder de la presidencia tiene acceso acorde a su responsabilidad.
- La app se usa en el teléfono (PWA) durante la semana, no solo en la laptop del secretario.

---

## Relación con el resto de la documentación

| Documento | Contenido |
|---|---|
| [README](../README.md) | Guía de páginas, instalación y cómo ayuda a las presidencias |
| [ARQUITECTURA.md](ARQUITECTURA.md) | Stack, estructura y patrones técnicos |
| [SEGURIDAD.md](SEGURIDAD.md) | Multi-tenant, auth, reglas y amenazas |
| [SINCRONIZACION_MINISTRACION.md](SINCRONIZACION_MINISTRACION.md) | Sync miembros ↔ compañerismos |
| [CHURCH_CHAT.md](CHURCH_CHAT.md) | Alcance del chat con IA |
| [DASHBOARD_HOME.md](DASHBOARD_HOME.md) | Detalle de tarjetas del inicio |
| [PUSH_NOTIFICATIONS.md](PUSH_NOTIFICATIONS.md) | Push y cron de cumpleaños |
| [COMPLIANCE.md](COMPLIANCE.md) | Cumplimiento y políticas |

---

## Resumen en una frase

> SionFlow ayuda a la presidencia del Quórum de Élderes y de la Sociedad de Socorro a **ver, priorizar y actuar** sobre el cuidado de las personas de su organización — en un solo sistema, por barrio y con roles claros — para que el consejo y el trabajo semanal se centren en **quién necesita atención**, no en **dónde está la información**.
