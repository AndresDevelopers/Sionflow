/**
 * Sincronización inversa: de Ministración a Miembros (REFACTORED)
 * Cuando se elimina o modifica un compañerismo, actualiza los maestros ministrantes de los miembros
 */

import { getDocs, query, where, writeBatch, WriteBatch, doc } from 'firebase/firestore';
import { membersCollection } from './collections';
import { firestore } from './firebase';
import type { Member } from './types';
import logger from './logger';

// ============================================================================
// TYPES & CONSTANTS
// ============================================================================

const BATCH_SIZE_LIMIT = 500;

interface UpdateOperation {
  memberId: string;
  memberName: string;
  oldTeachers: string[];
  newTeachers: string[];
}

interface SyncResult {
  success: boolean;
  updatedCount: number;
  failedMembers: Array<{ id: string; name: string; error: string }>;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extrae el apellido de un nombre de familia
 * Soporta múltiples idiomas y formatos
 */
function extractLastNameFromFamilyName(familyName: string, locale: string = 'es'): string {
  const prefixes: Record<string, string> = {
    es: 'Familia ',
    en: 'Family '
  };
  
  // Try to match any known prefix
  for (const [lang, prefix] of Object.entries(prefixes)) {
    if (familyName.startsWith(prefix)) {
      return familyName.replace(prefix, '').trim();
    }
  }
  
  // If no prefix matches, log warning and return as-is
  logger.warn({ familyName, locale, message: 'Family name does not match expected format' });
  return familyName.trim();
}

/**
 * Obtiene todos los miembros de una familia por apellido
 * @param lastName - Apellido de la familia a buscar
 * @returns Array de miembros que coinciden con el apellido
 * @throws Error si falla la consulta a Firestore
 */
async function getMembersByLastName(lastName: string): Promise<Member[]> {
  const memberQuery = query(membersCollection, where('lastName', '==', lastName));
  const memberSnap = await getDocs(memberQuery);
  
  return memberSnap.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  } as Member));
}

/**
 * Calcula los nuevos maestros ministrantes para un miembro
 * @param currentTeachers - Lista actual de maestros del miembro
 * @param teachersToRemove - Maestros a eliminar
 * @param teachersToAdd - Maestros a agregar
 * @returns Nueva lista de maestros sin duplicados
 */
function calculateUpdatedTeachers(
  currentTeachers: string[],
  teachersToRemove: string[],
  teachersToAdd: string[]
): string[] {
  // Remover maestros antiguos
  const withoutOld = currentTeachers.filter(t => !teachersToRemove.includes(t));
  
  // Agregar nuevos maestros (usando Set para evitar duplicados)
  return [...new Set([...withoutOld, ...teachersToAdd])];
}

/**
 * Compara dos arrays de strings sin importar el orden
 */
function arraysEqual(arr1: string[], arr2: string[]): boolean {
  if (arr1.length !== arr2.length) return false;
  const sorted1 = [...arr1].sort();
  const sorted2 = [...arr2].sort();
  return sorted1.every((val, idx) => val === sorted2[idx]);
}

/**
 * Ejecuta operaciones de actualización en lotes
 */
async function executeBatchUpdates(operations: UpdateOperation[]): Promise<SyncResult> {
  let batch: WriteBatch = writeBatch(firestore);
  let batchCount = 0;
  let updatedCount = 0;
  const failedMembers: Array<{ id: string; name: string; error: string }> = [];

  for (const operation of operations) {
    try {
      const memberRef = doc(membersCollection, operation.memberId);
      batch.update(memberRef, { ministeringTeachers: operation.newTeachers });
      batchCount++;
      updatedCount++;

      console.log(`  ✏️ Updating ${operation.memberName}:`, {
        before: operation.oldTeachers,
        after: operation.newTeachers
      });

      // Commit y crear nuevo batch si alcanzamos el límite
      if (batchCount >= BATCH_SIZE_LIMIT) {
        await batch.commit();
        batch = writeBatch(firestore);
        batchCount = 0;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      failedMembers.push({
        id: operation.memberId,
        name: operation.memberName,
        error: errorMessage
      });
      logger.error({ 
        error, 
        memberId: operation.memberId,
        memberName: operation.memberName,
        oldTeachers: operation.oldTeachers,
        newTeachers: operation.newTeachers,
        message: 'Failed to update member' 
      });
    }
  }

  // Commit operaciones restantes
  if (batchCount > 0) {
    await batch.commit();
  }

  return {
    success: failedMembers.length === 0,
    updatedCount,
    failedMembers
  };
}

/**
 * Procesa familias y genera operaciones de actualización
 * @param familyNames - Nombres de las familias a procesar
 * @param teachersToRemove - Maestros a eliminar
 * @param teachersToAdd - Maestros a agregar
 * @returns Array de operaciones de actualización
 */
async function processFamilies(
  familyNames: string[],
  teachersToRemove: string[],
  teachersToAdd: string[]
): Promise<UpdateOperation[]> {
  const operations: UpdateOperation[] = [];
  const memberCache = new Map<string, Member[]>();

  // Procesar familias en paralelo para mejor rendimiento
  const familyPromises = familyNames.map(async (familyName) => {
    const lastName = extractLastNameFromFamilyName(familyName);
    
    // Check cache first to avoid duplicate queries
    let members = memberCache.get(lastName);
    if (!members) {
      members = await getMembersByLastName(lastName);
      memberCache.set(lastName, members);
    }
    
    // Procesar TODOS los miembros de la familia, no solo aquellos con maestros existentes
    // Esto es importante para agregar maestros a nuevas familias
    return members
      .map(member => {
        const currentTeachers = member.ministeringTeachers || [];
        const updatedTeachers = calculateUpdatedTeachers(
          currentTeachers,
          teachersToRemove,
          teachersToAdd
        );

        // Solo incluir si hay cambios reales
        if (!arraysEqual(currentTeachers, updatedTeachers)) {
          console.log(`  👤 Will update ${member.firstName} ${member.lastName}:`, {
            from: currentTeachers.length > 0 ? currentTeachers : '(sin maestros)',
            to: updatedTeachers.length > 0 ? updatedTeachers : '(sin maestros)',
            teachersToAdd: teachersToAdd.length > 0 ? teachersToAdd : 'none',
            teachersToRemove: teachersToRemove.length > 0 ? teachersToRemove : 'none'
          });
          return {
            memberId: member.id,
            memberName: `${member.firstName} ${member.lastName}`,
            oldTeachers: currentTeachers,
            newTeachers: updatedTeachers
          };
        }
        return null;
      })
      .filter((op): op is UpdateOperation => op !== null);
  });

  const familyOperations = await Promise.all(familyPromises);
  return familyOperations.flat();
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Elimina los maestros ministrantes de las familias cuando se elimina un compañerismo
 * @param companionNames - Nombres de los compañeros del compañerismo eliminado
 * @param familyNames - Nombres de las familias asignadas
 */
export async function removeMinisteringTeachersFromFamilies(
  companionNames: string[],
  familyNames: string[]
): Promise<SyncResult> {
  // Validate inputs
  if (!companionNames?.length || !familyNames?.length) {
    return {
      success: true,
      updatedCount: 0,
      failedMembers: []
    };
  }

  try {
    console.log('🔄 Removing ministering teachers from families:', {
      companions: companionNames,
      families: familyNames
    });

    const operations = await processFamilies(familyNames, companionNames, []);
    const result = await executeBatchUpdates(operations);

    console.log(`✅ Successfully removed ministering teachers from ${result.updatedCount} member(s)`);
    return result;

  } catch (error) {
    logger.error({ error, message: 'Error removing ministering teachers from families' });
    throw new Error(`Error al eliminar maestros ministrantes: ${error instanceof Error ? error.message : 'Error desconocido'}`);
  }
}

/**
 * Actualiza los maestros ministrantes cuando se modifica un compañerismo
 * @param oldCompanions - Compañeros anteriores
 * @param newCompanions - Compañeros nuevos
 * @param oldFamilies - Familias anteriores
 * @param newFamilies - Familias nuevas
 */
export async function updateMinisteringTeachersOnCompanionshipChange(
  oldCompanions: string[],
  newCompanions: string[],
  oldFamilies: string[],
  newFamilies: string[]
): Promise<SyncResult> {
  // Validate inputs
  if (!oldCompanions?.length && !newCompanions?.length) {
    return {
      success: true,
      updatedCount: 0,
      failedMembers: []
    };
  }

  try {
    console.log('🔄 [SYNC] Updating ministering teachers on companionship change:', {
      oldCompanions,
      newCompanions,
      oldFamilies,
      newFamilies
    });

    // Calcular diferencias
    const removedFamilies = oldFamilies.filter(f => !newFamilies.includes(f));
    const addedFamilies = newFamilies.filter(f => !oldFamilies.includes(f));
    const remainingFamilies = oldFamilies.filter(f => newFamilies.includes(f));
    const companionsChanged = !arraysEqual(oldCompanions, newCompanions);

    console.log('📊 [SYNC] Differences detected:', {
      removedFamilies: removedFamilies.length > 0 ? removedFamilies : 'none',
      addedFamilies: addedFamilies.length > 0 ? addedFamilies : 'none',
      remainingFamilies: remainingFamilies.length > 0 ? remainingFamilies : 'none',
      companionsChanged
    });

    // Procesar todas las operaciones en paralelo
    const [removeOps, addOps, updateOps] = await Promise.all([
      // 1. Eliminar maestros de familias removidas
      removedFamilies.length > 0
        ? (console.log('📍 [SYNC] Processing: REMOVE teachers from deleted families'), processFamilies(removedFamilies, oldCompanions, []))
        : Promise.resolve([]),
      
      // 2. Agregar maestros a familias nuevas
      addedFamilies.length > 0
        ? (console.log('📍 [SYNC] Processing: ADD teachers to new families'), processFamilies(addedFamilies, [], newCompanions))
        : Promise.resolve([]),
      
      // 3. Actualizar maestros en familias que permanecen (si compañeros cambiaron)
      companionsChanged && remainingFamilies.length > 0
        ? (console.log('📍 [SYNC] Processing: UPDATE teachers in remaining families'), processFamilies(remainingFamilies, oldCompanions, newCompanions))
        : Promise.resolve([])
    ]);

    // Combinar todas las operaciones
    const allOperations = [...removeOps, ...addOps, ...updateOps];

    console.log(`📈 [SYNC] Total operations to execute: ${allOperations.length}`);

    if (allOperations.length === 0) {
      console.log('ℹ️ [SYNC] No changes needed');
      return { success: true, updatedCount: 0, failedMembers: [] };
    }

    // Ejecutar actualizaciones
    console.log('💾 [SYNC] Starting batch updates...');
    const result = await executeBatchUpdates(allOperations);

    console.log(`✅ [SYNC] Updated ${result.updatedCount} member(s)`, result);
    return result;

  } catch (error) {
    logger.error({ error, message: 'Error updating ministering teachers on companionship change' });
    throw new Error(`Error al actualizar maestros ministrantes: ${error instanceof Error ? error.message : 'Error desconocido'}`);
  }
}
