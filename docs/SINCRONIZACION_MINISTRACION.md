# Sincronización Bidireccional de Ministración

## Descripción General

Se ha implementado un sistema de **sincronización bidireccional** entre la página de **Miembros** y la página de **Ministración**. Esto significa que los cambios realizados en cualquiera de las dos páginas se reflejan automáticamente en la otra.

## Flujos de Sincronización

### 1. De Miembros → Ministración (Sincronización Directa)

**Archivo:** `src/lib/ministering-sync.ts`

**¿Cuándo se ejecuta?**
- Al crear un nuevo miembro con maestros ministrantes asignados
- Al editar un miembro y modificar sus maestros ministrantes

**¿Qué hace?**
1. Detecta los maestros ministrantes asignados al miembro
2. Busca si existe un compañerismo con esos mismos maestros
3. Si existe, agrega la familia del miembro a ese compañerismo con su memberId
4. Si no existe, crea un nuevo compañerismo automáticamente

**Ejemplo:**
```
Miembro: Juan Pérez
Maestros Ministrantes: [Pedro García, Luis Martínez]

→ Se crea/actualiza el compañerismo:
   Compañeros: Pedro García, Luis Martínez
   Familias: Familia Pérez (memberId)
```

### 2. De Ministración → Miembros (Sincronización Inversa)

**Archivo:** `src/lib/ministering-reverse-sync.ts`

**¿Cuándo se ejecuta?**
- Al eliminar un compañerismo
- Al editar un compañerismo (cambiar compañeros o familias)

**¿Qué hace?**

#### Al Eliminar un Compañerismo:
1. Identifica todos los compañeros del compañerismo
2. Identifica todas las familias asignadas
3. Busca los miembros de esas familias
4. Elimina los maestros ministrantes de esos miembros

**Ejemplo:**
```
Compañerismo eliminado:
   Compañeros: Pedro García, Luis Martínez
   Familias: Familia Pérez (memberId), Familia López (memberId)

→ Se actualiza:
   Juan Pérez: ministeringTeachers = [] (vacío)
   María López: ministeringTeachers = [] (vacío)
```

#### Al Editar un Compañerismo:
1. Compara los compañeros antiguos vs nuevos
2. Compara las familias antiguas vs nuevas
3. Actualiza los maestros ministrantes según los cambios:
   - **Familias eliminadas**: Se les quitan los maestros antiguos
   - **Familias agregadas**: Se les agregan los maestros nuevos
   - **Familias que permanecen**: Se actualizan si los compañeros cambiaron

**Ejemplo:**
```
Antes:
   Compañeros: [Pedro García, Luis Martínez]
   Familias: [Familia Pérez]

Después:
   Compañeros: [Pedro García, Juan Rodríguez]
   Familias: [Familia Pérez, Familia López]

→ Se actualiza:
   Juan Pérez: ministeringTeachers = [Pedro García, Juan Rodríguez]
   María López: ministeringTeachers = [Pedro García, Juan Rodríguez]
```

## Funciones Principales

### `syncMinisteringAssignments(member, previousTeachers)`
**Ubicación:** `src/lib/ministering-sync.ts`

Sincroniza de Miembros → Ministración cuando se asignan maestros ministrantes a un miembro.

**Parámetros:**
- `member`: El miembro actualizado con sus maestros ministrantes
- `previousTeachers`: Los maestros ministrantes anteriores (para detectar cambios)

### `removeMinisteringTeachersFromFamilies(companionNames, familyNames)`
**Ubicación:** `src/lib/ministering-reverse-sync.ts`

Elimina maestros ministrantes de las familias cuando se elimina un compañerismo.

**Parámetros:**
- `companionNames`: Nombres de los compañeros del compañerismo eliminado
- `familyNames`: Nombres de las familias que tenían asignados esos maestros

### `updateMinisteringTeachersOnCompanionshipChange(oldCompanions, newCompanions, oldFamilies, newFamilies)`
**Ubicación:** `src/lib/ministering-reverse-sync.ts`

Actualiza maestros ministrantes cuando se modifica un compañerismo.

**Parámetros:**
- `oldCompanions`: Compañeros anteriores
- `newCompanions`: Compañeros nuevos
- `oldFamilies`: Familias anteriores
- `newFamilies`: Familias nuevas

## Herramienta de Migración

**Archivo:** `src/lib/migrate-ministering.ts`  
**Página:** `/ministering/migrate`

### ¿Para qué sirve?
Sincroniza los datos existentes cuando se implementa por primera vez el sistema de sincronización.

### ¿Cómo funciona?
1. Lee todos los miembros de la base de datos
2. Identifica los que tienen maestros ministrantes asignados
3. Crea automáticamente los compañerismos correspondientes
4. Procesa en lotes para mejor rendimiento

### ¿Cuándo usarla?
- **Una sola vez** después de implementar el sistema
- Si se detectan inconsistencias entre Miembros y Ministración
- Es seguro ejecutarla múltiples veces (no duplica datos)

## Casos de Uso

### Caso 1: Asignar Maestros Ministrantes a un Miembro
1. Ir a **Miembros**
2. Editar un miembro
3. Asignar maestros ministrantes
4. Guardar
5. ✅ Automáticamente aparece en **Ministración**

### Caso 2: Eliminar un Compañerismo
1. Ir a **Ministración**
2. Seleccionar un compañerismo
3. Hacer clic en "Eliminar"
4. Confirmar
5. ✅ Los maestros ministrantes se eliminan de los miembros

### Caso 3: Cambiar Compañeros de un Compañerismo
1. Ir a **Ministración**
2. Seleccionar un compañerismo
3. Hacer clic en "Editar"
4. Cambiar los compañeros
5. Guardar
6. ✅ Los miembros se actualizan con los nuevos maestros

### Caso 4: Agregar/Quitar Familias de un Compañerismo
1. Ir a **Ministración**
2. Seleccionar un compañerismo
3. Hacer clic en "Editar"
4. Agregar o quitar familias
5. Guardar
6. ✅ Los maestros ministrantes se actualizan en los miembros correspondientes

## Ventajas del Sistema

✅ **Consistencia de Datos**: Los datos siempre están sincronizados entre ambas páginas  
✅ **Flexibilidad**: Se puede trabajar desde cualquier página  
✅ **Automatización**: No hay que actualizar manualmente en dos lugares  
✅ **Prevención de Errores**: Evita inconsistencias y datos huérfanos  
✅ **Auditoría**: Todos los cambios se registran en los logs  

## Consideraciones Técnicas

### Rendimiento
- Las operaciones se realizan en lotes (batch) para mejor rendimiento
- Se usa `writeBatch` de Firestore para operaciones atómicas
- Límite de 500 operaciones por batch

### Manejo de Errores
- Todos los errores se registran en los logs
- Se muestran mensajes de error al usuario
- Las operaciones fallidas no afectan las exitosas

### Validaciones
- Se valida que no haya duplicados
- Se verifica que los nombres de familia coincidan con apellidos de miembros
- Se previenen conflictos de asignación

## Archivos Modificados

### Nuevos Archivos
- `src/lib/ministering-sync.ts` - Sincronización directa
- `src/lib/ministering-reverse-sync.ts` - Sincronización inversa
- `src/lib/migrate-ministering.ts` - Herramienta de migración
- `src/app/(main)/ministering/migrate/page.tsx` - Página de migración

### Archivos Modificados
- `src/components/members/member-form.tsx` - Agregada sincronización al guardar
- `src/app/(main)/ministering/[id]/page.tsx` - Agregada sincronización al eliminar
- `src/app/(main)/ministering/CompanionshipForm.tsx` - Agregada sincronización al editar
- `src/app/(main)/ministering/page.tsx` - Agregado botón para crear compañerismos

## Logs y Debugging

El sistema genera logs detallados en la consola del navegador:

```
🔄 Syncing ministering assignments for: { memberName, newTeachers, previousTeachers }
📋 Current companionships: X
➕ Adding family to existing companionship
🆕 Creating new companionship
✅ Ministering assignments synced successfully
```

Para ver los logs, abre la consola del navegador (F12) y busca los emojis 🔄, ✅, ❌.
