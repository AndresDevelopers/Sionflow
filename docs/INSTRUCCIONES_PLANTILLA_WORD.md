# Instrucciones para Actualizar la Plantilla de Word

## Ubicación de la Plantilla
La plantilla de Word se encuentra en Firebase Storage en la ruta:
```
template/reporte.docx
```

## Cambios Necesarios

### 1. Agregar Separadores entre Actividades

En la sección donde se listan las actividades (probablemente usando un loop como `{#actividades_por_mes}` o `{#lista_actividades}`), agregar el campo `{separator}` al final de cada actividad.

**Ejemplo de cómo debería verse en la plantilla:**

```
{#actividades_por_mes}
  {#activities}
    Título: {title}
    Fecha: {fullDate}
    Descripción: {description}
    
    {separator}
  {/activities}
{/actividades_por_mes}
```

O si usas `lista_actividades`:

```
{#lista_actividades}
  Título: {title}
  Fecha: {fullDate}
  Descripción: {description}
  
  {separator}
{/lista_actividades}
```

### 2. Agregar Separadores entre Bautismos

En la sección donde se listan los bautismos (probablemente usando `{#resumen_bautismos}` o `{#galeria_bautismos}`), agregar el campo `{separator}` al final de cada bautismo.

**Ejemplo de cómo debería verse en la plantilla:**

```
{#resumen_bautismos}
  Nombre: {nombre}
  Fecha: {fecha}
  Origen: {origen}
  
  {separator}
{/resumen_bautismos}
```

O si usas `galeria_bautismos`:

```
{#galeria_bautismos}
  Nombre: {nombre}
  Fecha: {fecha}
  Origen: {origen}
  
  {separator}
{/galeria_bautismos}
```

## Valor del Separador

El separador es una línea de guiones que se verá así en el documento:
```
─────────────────────────────────────────────────────
```

## Alternativas de Formato

Si prefieres otro tipo de separador, puedes:

1. **Usar el separador como está**: Simplemente coloca `{separator}` en la plantilla
2. **Reemplazar con saltos de línea**: En lugar de `{separator}`, usa varios saltos de línea
3. **Usar líneas horizontales de Word**: Ignora el campo `{separator}` y agrega líneas horizontales manualmente en la plantilla

## Cómo Actualizar la Plantilla

1. Descarga la plantilla actual de Firebase Storage
2. Abre el archivo `reporte.docx` en Microsoft Word
3. Haz clic derecho → "Editar documento" (si está protegido)
4. Busca las secciones de loops de actividades y bautismos
5. Agrega `{separator}` al final de cada loop (antes del cierre `{/...}`)
6. Guarda el archivo
7. Sube el archivo actualizado a Firebase Storage en la misma ubicación

## Verificación

Después de actualizar la plantilla:
1. Genera un reporte de prueba
2. Verifica que cada actividad y bautismo tenga una línea separadora
3. Ajusta el formato si es necesario

## Notas Técnicas

- El campo `separator` está disponible en ambos objetos: `ActivityDocEntry` y `BaptismDocEntry`
- El valor del separador es: `"─────────────────────────────────────────────────────"`
- Si necesitas cambiar el estilo del separador, modifica el valor en `functions/src/index.ts` líneas donde se define `separator:`
