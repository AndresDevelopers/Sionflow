# Chat de la Iglesia (DeepSeek)

## Objetivo

Este módulo agrega una página de chat enfocada **solo** en contenido oficial de La Iglesia de Jesucristo de los Santos de los Últimos Días.

## Alcance funcional

- Ruta: `/church-chat`.
- Historial de conversaciones en `localStorage` (cliente).
- Persistencia en Firestore (`users/{uid}/appData/churchChat`) con fallback automático a `localStorage` si Firestore no está disponible.
- Botón para crear un chat nuevo.
- Eliminación de conversaciones desde el historial.
- Indicador de "La IA está escribiendo..." mientras se espera la respuesta.
- Dictado por micrófono en navegadores compatibles con Web Speech API; el texto reconocido se coloca en la entrada antes de enviar.
- Acciones por respuesta de la IA para copiar todo el texto al portapapeles o escucharlo mediante síntesis de voz del navegador.
- Renderizado básico de formato de respuesta para listas y énfasis markdown (`-`, `*`, `**`).
- Soporte opcional para subir imagen como contexto.
- Si se envía imagen, el texto se vuelve opcional.
- Fallback de modelo automático (`DEEPSEEK_CHAT_MODEL`, luego `deepseek-chat` / `deepseek-v4-pro`) para mejorar disponibilidad.
- Timeout y tokens por defecto más altos en el chat (`DEEPSEEK_TIMEOUT_MS` 30s, `DEEPSEEK_MAX_TOKENS` 1600) porque listar llamamientos con explicación supera con facilidad 8s / 800 tokens.
- Botón **Otros cargos** (y preguntas equivalentes de lista completa): respuesta inmediata desde el catálogo de la organización del usuario, sin depender de DeepSeek (evita el error “No se pudo obtener respuesta de DeepSeek” por timeout).
- Restricción temática por *system prompt*:
  - Manuales y textos oficiales de la Iglesia.
  - Evangelio de Jesucristo y Escrituras (Antiguo/Nuevo Testamento) según interpretación oficial de la Iglesia.
  - Si el usuario sale del tema, el asistente responde que el chat es exclusivo para temas de la Iglesia.
  - Las respuestas deben explicar con claridad el **porqué** (razón y propósito) de lo que describen.
  - Preguntas sobre la app de gestión: orientación general + recordatorio de que el control de la app corresponde a la **presidencia de la organización del usuario** (nombre dinámico enviado por el cliente); no inventa datos del barrio.
- Contexto de sesión dinámico:
  - El cliente envía `organizacion` del usuario autenticado.
  - El servidor inyecta el nombre de la app (`getAppName()`) y la organización en el *system prompt*.
  - Catálogo de llamamientos por organización (`src/lib/church-organization-callings.ts`): al preguntar por cargos/llamamientos (botón **Otros cargos** u otras preguntas), la IA debe enumerar **todos** los llamamientos y asignaciones típicos de **esa** organización (no mezclar con otras), con el “por qué” de cada uno.
  - Organizaciones con catálogo: Quórum de Élderes, Sociedad de Socorro, Primaria, Mujeres Jóvenes, Hombres Jóvenes, Escuela Dominical (coincidencia flexible ES/EN).
  - Los botones de presidencia/consejería/secretaría adaptan el género del título según la organización (p. ej. Presidenta en Sociedad de Socorro).
- Verificación de noticias oficiales recientes:
  - Se consulta el RSS de Newsroom de la Iglesia.
  - Se adjunta como contexto al prompt para preguntas de actualidad.

## Variables de entorno

Agregar al archivo `.env` / `.env.local`:

```bash
# DeepSeek = IA de TODO en texto (chat, respuestas, contexto)
DEEPSEEK_API_KEY=tu_api_key
# opcional para endpoint del chat
DEEPSEEK_CHAT_MODEL=deepseek-v4-flash
# recomendado para listas largas (llamamientos)
DEEPSEEK_MAX_TOKENS=1600
DEEPSEEK_TIMEOUT_MS=30000

# Gemini = SOLO para IMÁGENES (si el usuario adjunta una foto al chat)
# DeepSeek no analiza fotos; Gemini describe la imagen y DeepSeek responde en texto.
GEMINI_API_KEY=tu_gemini_api_key
```

Si `DEEPSEEK_CHAT_MODEL` no está definida, el sistema usa `deepseek-v4-flash`.
Sin `GEMINI_API_KEY`, el chat de texto sigue funcionando; las imágenes no se analizan bien.

## Endpoints

- `POST /api/church-chat`
  - Entrada: `{ message?: string, imageDataUrl?: string, history: Array<{role, content}>, language?: 'es'|'en', organizacion?: string }`
  - Salida: `{ answer: string, contextNews: string }`
  - Producción (Vercel): `maxDuration = 60` para no cortar la respuesta de DeepSeek/Gemini.
  - El Service Worker **no** cachea esta ruta (NetworkOnly); evita timeouts de 5s de la PWA.

## Troubleshooting (solo producción)

Si el chat o las sugerencias fallan solo en `sionflow.com` y no en localhost:

1. En el host (Vercel u otro) → Settings → Environment Variables, confirma **Production**:
   - `DEEPSEEK_API_KEY`
   - `GEMINI_API_KEY` (solo imágenes)
   - `DEEPSEEK_TIMEOUT_MS=30000` (**no** dejes `8000`: corta respuestas reales y devuelve 504)
   - `FIREBASE_SERVICE_ACCOUNT_KEY` (auth de las APIs)
2. Redeploy tras cambiar env vars.
3. En el navegador: Application → Service Workers → Unregister + hard refresh (para tomar el SW nuevo).

### Síntoma: logs con `timeoutMs: 8000` y status 504

La API de DeepSeek suele responder en 2–8s en prompts cortos, pero con system prompt + noticias + historial a menudo supera **8s**. Si el host tiene `DEEPSEEK_TIMEOUT_MS=8000` (valor legacy), el chat aborta y prueba los modelos de fallback hasta fallar todos.

- El código ahora impone un **mínimo de 25s** aunque el env diga 8000.
- Aun así, actualiza el env del host a `30000` y vuelve a desplegar.

### Sugerencias de Actividades / Servicios vacías solo en producción

Rutas: `GET /api/suggestions`, `GET /api/service-suggestions` (mismo DeepSeek).

Causas frecuentes:
1. `DEEPSEEK_TIMEOUT_MS=8000` en el host (misma causa que church-chat).
2. Fallo de auth (`401`/`403`) si falta token o `barrioOrg` en `c_users`.
3. Schema JSON demasiado estricto (antes exigía exactamente 3 ítems) o timeout de la función serverless.

Mitigaciones en código:
- Timeout mínimo 25s + soft-deadline + fallback estático en API y cliente.
- El cliente nunca deja la tarjeta vacía: si falla la red/IA muestra sugerencias de respaldo.
- Validación de respuesta/cache local antes de renderizar.

## Notas de seguridad

- No se hardcodean secretos.
- Validación de entrada con Zod.
- El backend evita exponer la API key al cliente.
- Las funciones de micrófono, portapapeles y lectura usan APIs locales del navegador; si no están disponibles, se muestra un mensaje de error sin enviar audio al backend.
