/**
 * Sincronización inversa: de Ministración a Miembros
 * Cuando se elimina o modifica un compañerismo, actualiza los maestros ministrantes de los miembros.
 * ALWAYS scoped by barrioOrg — never query members across wards.
 */

import { getDocs, query, where, doc, writeBatch } from 'firebase/firestore';
import { membersCollection } from './collections';
import { firestore } from './firebase';
import type { Member } from './types';
import logger from './logger';

/**
 * Obtiene los miembros de varias familias en lotes de 30 (límite de Firestore para la cláusula 'in')
 * @param familyNames - Nombres de las familias a buscar
 * @param barrioOrg - Multi-tenant scope (required)
 */
async function getMembersByFamilies(
  familyNames: string[],
  barrioOrg: string
): Promise<Map<string, Member[]>> {
  const lastNamesMap = new Map<string, Member[]>();
  if (familyNames.length === 0 || !barrioOrg) return lastNamesMap;

  // Extraer apellidos únicos
  const uniqueLastNames = [...new Set(familyNames.map(f => f.replace('Familia ', '').trim()))];

  // Firestore permite hasta 30 elementos en una cláusula 'in'
  const CHUNK_SIZE = 30;
  for (let i = 0; i < uniqueLastNames.length; i += CHUNK_SIZE) {
    const batch = uniqueLastNames.slice(i, i + CHUNK_SIZE);
    const memberQuery = query(
      membersCollection,
      where('barrioOrg', '==', barrioOrg),
      where('lastName', 'in', batch)
    );
    const memberSnap = await getDocs(memberQuery);

    memberSnap.forEach((docSnap) => {
      const member = { id: docSnap.id, ...docSnap.data() } as Member;
      const lastName = member.lastName;
      if (!lastNamesMap.has(lastName)) {
        lastNamesMap.set(lastName, []);
      }
      lastNamesMap.get(lastName)!.push(member);
    });
  }

  return lastNamesMap;
}

/**
 * Elimina los maestros ministrantes de las familias cuando se elimina un compañerismo
 */
export async function removeMinisteringTeachersFromFamilies(
  companionNames: string[],
  familyNames: string[],
  barrioOrg: string
): Promise<void> {
  if (!barrioOrg) {
    throw new Error('barrioOrg es requerido para sincronizar ministración');
  }
  try {
    const normalizedCompanions = companionNames.map(name => name.trim().toLowerCase());

    console.log('🔄 Removing ministering teachers from families:', {
      companions: companionNames,
      families: familyNames,
      barrioOrg,
    });

    let batch = writeBatch(firestore);
    let batchCount = 0;

    const membersByFamilies = await getMembersByFamilies(familyNames, barrioOrg);

    for (const familyName of familyNames) {
      const lastName = familyName.replace('Familia ', '').trim();
      const members = membersByFamilies.get(lastName) || [];

      for (const member of members) {
        if (member.ministeringTeachers && member.ministeringTeachers.length > 0) {
          const updatedTeachers = member.ministeringTeachers.filter(
            teacher => !normalizedCompanions.includes(teacher.trim().toLowerCase())
          );

          if (updatedTeachers.length !== member.ministeringTeachers.length) {
            console.log(`  ✏️ Updating ${member.firstName} ${member.lastName}:`, {
              before: member.ministeringTeachers,
              after: updatedTeachers
            });

            const memberRef = doc(membersCollection, member.id);
            batch.update(memberRef, { ministeringTeachers: updatedTeachers });
            batchCount++;

            if (batchCount >= 500) {
              await batch.commit();
              batch = writeBatch(firestore);
              batchCount = 0;
            }
          }
        }
      }
    }

    if (batchCount > 0) {
      await batch.commit();
    }

    console.log('✅ Successfully removed ministering teachers from families');
  } catch (error) {
    logger.error({ error, message: 'Error removing ministering teachers from families' });
    throw new Error(`Error al eliminar maestros ministrantes: ${error instanceof Error ? error.message : 'Error desconocido'}`);
  }
}

/**
 * Actualiza los maestros ministrantes cuando se modifica un compañerismo
 */
export async function updateMinisteringTeachersOnCompanionshipChange(
  oldCompanions: string[],
  newCompanions: string[],
  oldFamilies: string[],
  newFamilies: string[],
  barrioOrg: string
): Promise<void> {
  if (!barrioOrg) {
    throw new Error('barrioOrg es requerido para sincronizar ministración');
  }
  try {
    console.log('🔄 Updating ministering teachers on companionship change:', {
      oldCompanions,
      newCompanions,
      oldFamilies,
      newFamilies,
      barrioOrg,
    });

    const removedFamilies = oldFamilies.filter(f => !newFamilies.includes(f));
    const addedFamilies = newFamilies.filter(f => !oldFamilies.includes(f));
    const remainingFamilies = oldFamilies.filter(f => newFamilies.includes(f));

    let batch = writeBatch(firestore);
    let batchCount = 0;

    const maybeCommit = async () => {
      if (batchCount >= 500) {
        await batch.commit();
        batch = writeBatch(firestore);
        batchCount = 0;
      }
    };

    const allUniqueFamilies = [...new Set([...removedFamilies, ...addedFamilies, ...remainingFamilies])];
    const membersByFamilies = await getMembersByFamilies(allUniqueFamilies, barrioOrg);

    if (removedFamilies.length > 0) {
      for (const familyName of removedFamilies) {
        const lastName = familyName.replace('Familia ', '').trim();
        const members = membersByFamilies.get(lastName) || [];

        for (const member of members) {
          if (member.ministeringTeachers && member.ministeringTeachers.length > 0) {
            const updatedTeachers = member.ministeringTeachers.filter(
              teacher => !oldCompanions.includes(teacher)
            );

            if (updatedTeachers.length !== member.ministeringTeachers.length) {
              console.log(`  ➖ Removing from ${member.firstName} ${member.lastName}`);
              const memberRef = doc(membersCollection, member.id);
              batch.update(memberRef, { ministeringTeachers: updatedTeachers });
              batchCount++;
              await maybeCommit();
            }
          }
        }
      }
    }

    if (addedFamilies.length > 0) {
      for (const familyName of addedFamilies) {
        const lastName = familyName.replace('Familia ', '').trim();
        const members = membersByFamilies.get(lastName) || [];

        for (const member of members) {
          const currentTeachers = member.ministeringTeachers || [];
          const newTeachers = [...new Set([...currentTeachers, ...newCompanions])];

          if (newTeachers.length !== currentTeachers.length) {
            console.log(`  ➕ Adding to ${member.firstName} ${member.lastName}`);
            const memberRef = doc(membersCollection, member.id);
            batch.update(memberRef, { ministeringTeachers: newTeachers });
            batchCount++;
            await maybeCommit();
          }
        }
      }
    }

    const companionsChanged = JSON.stringify([...oldCompanions].sort()) !== JSON.stringify([...newCompanions].sort());

    if (companionsChanged && remainingFamilies.length > 0) {
      for (const familyName of remainingFamilies) {
        const lastName = familyName.replace('Familia ', '').trim();
        const members = membersByFamilies.get(lastName) || [];

        for (const member of members) {
          const currentTeachers = member.ministeringTeachers || [];

          const withoutOld = currentTeachers.filter(t => !oldCompanions.includes(t));
          const updatedTeachers = [...new Set([...withoutOld, ...newCompanions])];

          if (JSON.stringify([...updatedTeachers].sort()) !== JSON.stringify([...currentTeachers].sort())) {
            console.log(`  🔄 Updating ${member.firstName} ${member.lastName}`);
            const memberRef = doc(membersCollection, member.id);
            batch.update(memberRef, { ministeringTeachers: updatedTeachers });
            batchCount++;
            await maybeCommit();
          }
        }
      }
    }

    if (batchCount > 0) {
      await batch.commit();
      console.log(`✅ Updated ${batchCount} member(s)`);
    } else {
      console.log('ℹ️ No changes needed');
    }

  } catch (error) {
    logger.error({ error, message: 'Error updating ministering teachers on companionship change' });
    throw new Error(`Error al actualizar maestros ministrantes: ${error instanceof Error ? error.message : 'Error desconocido'}`);
  }
}
