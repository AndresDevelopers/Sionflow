# Configuración de Bautismos en la Plantilla Word

## Resumen
Este documento explica cómo configurar la plantilla `template/reporte.docx` para mostrar correctamente todos los bautismos del año con sus imágenes.

## Datos Disponibles en la Plantilla

La función `generateCompleteReport` envía los siguientes datos sobre bautismos:

### 1. Variables Simples
- `{total_bautismos}` - Total de bautismos del año
- `{total_imagenes_bautismos}` - Total de imágenes de bautismos
- `{bautismos_con_imagenes}` - Cantidad de bautismos con fotos

### 2. Array: `tabla_bautismos` / `resumen_bautismos`
Cada bautismo contiene:
- `{nombre}` - Nombre completo
- `{fecha}` - Fecha completa (ej: "15 de marzo de 2024")
- `{fecha_corta}` - Fecha corta (ej: "15/03/2024")
- `{dia_semana}` - Día de la semana
- `{origen}` - Fuente: "Automático", "Futuro Miembro", "Nuevo Converso", "Manual"
- `{mes}` - Mes del bautismo
- `{hasImages}` - true/false si tiene imágenes
- `{imageCount}` - Cantidad de imágenes
- `{photoURL}` - URL de foto de perfil (si existe)
- `{images}` - Array de imágenes del bautismo

### 3. Array: `galeria_bautismos`
Solo bautismos con imágenes:
- `{nombre}` - Nombre
- `{fecha}` - Fecha completa
- `{origen}` - Fuente
- `{cantidad}` - Cantidad de imágenes
- `{foto_perfil}` - URL de foto de perfil
- `{imagenes}` - Array de imágenes


## Configuración en Word con Docxtemplater

### Opción 1: Tabla Simple de Bautismos

```
{#tabla_bautismos}
Nombre: {nombre}
Fecha: {fecha}
Origen: {origen}
{/tabla_bautismos}
```

### Opción 2: Tabla con Imágenes

```
{#resumen_bautismos}
Nombre: {nombre}
Fecha: {fecha}
Origen: {origen}

{#images}
{%image}
Foto {order} - {caption}
{/images}

{/resumen_bautismos}
```

### Opción 3: Solo Bautismos con Fotos (Galería)

```
{#galeria_bautismos}
{nombre} - {fecha}
Origen: {origen}
Total de fotos: {cantidad}

{#imagenes}
{%image}
{caption}
{/imagenes}

{/galeria_bautismos}
```

### Opción 4: Tabla Completa con Foto de Perfil

```
{#resumen_bautismos}
Nombre: {nombre}
Fecha: {fecha}
Origen: {origen}

{#photoURL}
Foto de perfil:
{%photoURL}
{/photoURL}

{#hasImages}
Fotos del bautismo ({imageCount} fotos):
{#images}
{%image}
{/images}
{/hasImages}

{/resumen_bautismos}
```


## Ejemplo Completo Recomendado

Para mostrar todos los bautismos del año con sus imágenes, agrega esta sección en tu plantilla Word:

```
═══════════════════════════════════════════════════════
BAUTISMOS DEL AÑO {anho_reporte}
═══════════════════════════════════════════════════════

Total de bautismos: {total_bautismos}
Bautismos con fotografías: {bautismos_con_imagenes}
Total de imágenes: {total_imagenes_bautismos}

───────────────────────────────────────────────────────
LISTADO COMPLETO DE BAUTISMOS
───────────────────────────────────────────────────────

{#resumen_bautismos}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Nombre: {nombre}
Fecha: {fecha} ({dia_semana})
Origen: {origen}

{#photoURL}
[Foto de perfil]
{%photoURL}
{/photoURL}

{#hasImages}
Fotografías del bautismo ({imageCount}):

{#images}
{%image}
{caption}

{/images}
{/hasImages}

{/resumen_bautismos}
```

## Notas Importantes

1. **Sintaxis de Docxtemplater**:
   - `{#array}...{/array}` - Loop sobre un array
   - `{variable}` - Insertar texto
   - `{%image}` - Insertar imagen (requiere ModernImageModule)
   - `{#condition}...{/condition}` - Condicional (solo si existe)

2. **Imágenes**:
   - Las imágenes se insertan automáticamente desde las URLs
   - El módulo `ModernImageModule` descarga y embebe las imágenes
   - Las imágenes mantienen proporciones y se ajustan al ancho disponible

3. **Fuentes de Bautismos**:
   - **Automático**: Miembros con fecha de bautismo en el año actual
   - **Futuro Miembro**: Candidatos bautizados del registro de futuros miembros
   - **Nuevo Converso**: Conversos bautizados del registro de nuevos conversos
   - **Manual**: Bautismos agregados manualmente

4. **Campos de Imagen**:
   - `photoURL`: Foto de perfil del miembro (opcional)
   - `baptismPhotos`: Array de fotos del evento de bautismo (opcional)
   - Ambos campos se procesan y están disponibles en la plantilla


## Verificación

Para verificar que la plantilla está correctamente configurada:

1. **Subir la plantilla actualizada**:
   ```bash
   # Subir a Firebase Storage en la ruta: template/reporte.docx
   ```

2. **Probar la generación**:
   - Ve a la página de Reportes en la aplicación
   - Haz clic en "Descargar Reporte"
   - Abre el archivo Word generado
   - Verifica que aparezcan:
     - Todos los bautismos del año
     - Las fotos de perfil (si existen)
     - Las fotos del bautismo (si existen)

3. **Solución de problemas**:
   - Si no aparecen imágenes: Verifica que las URLs sean públicas o tengan tokens válidos
   - Si no aparecen bautismos: Verifica que existan registros con `baptismDate` en el año actual
   - Si el formato es incorrecto: Revisa la sintaxis de Docxtemplater en la plantilla

## Datos de Prueba

Para probar, asegúrate de tener:

1. **Miembros con fecha de bautismo**:
   - Campo `baptismDate` con Timestamp del año actual
   - Campo `baptismPhotos` (array de URLs) - opcional
   - Campo `photoURL` (string) - opcional

2. **Futuros miembros bautizados**:
   - Campo `baptismDate` con Timestamp del año actual
   - Campo `baptismPhotos` (array de URLs) - opcional

3. **Nuevos conversos bautizados**:
   - Campo `baptismDate` con Timestamp del año actual
   - Campo `baptismPhotos` (array de URLs) - opcional

## Actualización de REPORTES.md

Esta información complementa la documentación existente en `REPORTES.md`. La sección de bautismos debe agregarse a la plantilla Word siguiendo los ejemplos de este documento.
