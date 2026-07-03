/**
 * Script de migración para sincronizar maestros ministrantes existentes
 * y crear compañerismos automáticamente
 */

import { getDocs } from 'firebase/firestore';
import { membersCollection } from './collections';
import { syncMinisteringAssignments } from './ministering-sync';
import type { Member } from './types';

export interface MigrationResult {
  success: boolean;
  totalMembers: number;
  processedMembers: number;
  syncedMembers: number;
  failedMembers: Array<{ id: string; name: string; error: string }>;
  duration: number;
}

export interface MigrationOptions {
  batchSize?: number;
  dryRun?: boolean;
  onProgress?: (current: number, total: number) => void;
}

/**
 * Migra las asignaciones de ministración existentes en lotes paralelos
 */
export async function migrateExistingMinisteringAssignments(
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  const { batchSize = 10, dryRun = false, onProgress } = options;
  const startTime = Date.now();
  
  console.log('🔄 Starting migration of existing ministering assignments...');
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made');
  }
  
  try {
    // Obtener todos los miembros
    const membersSnapshot = await getDocs(membersCollection);
    const allMembers = membersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as Member));

    console.log(`📋 Found ${allMembers.length} members`);

    // Filtrar solo miembros con maestros ministrantes
    const membersToProcess = allMembers.filter(
      member => member.ministeringTeachers && member.ministeringTeachers.length > 0
    );

    console.log(`👥 ${membersToProcess.length} members have ministering teachers assigned`);

    if (membersToProcess.length === 0) {
      return {
        success: true,
        totalMembers: allMembers.length,
        processedMembers: 0,
        syncedMembers: 0,
        failedMembers: [],
        duration: Date.now() - startTime
      };
    }

    let syncedCount = 0;
    const failedMembers: Array<{ id: string; name: string; error: string }> = [];

    // Procesar en lotes paralelos
    for (let i = 0; i < membersToProcess.length; i += batchSize) {
      const batch = membersToProcess.slice(i, i + batchSize);
      
      console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(membersToProcess.length / batchSize)}`);
      
      // Procesar lote en paralelo
      const results = await Promise.allSettled(
        batch.map(async (member) => {
          console.log(`👤 Processing: ${member.firstName} ${member.lastName}`);
          console.log(`   Teachers: ${member.ministeringTeachers?.join(', ')}`);
          
          if (!dryRun) {
            await syncMinisteringAssignments(member, [], 'Libertad|Quórum de Élderes');
          }
          
          return member;
        })
      );

      // Procesar resultados del lote
      results.forEach((result, index) => {
        const member = batch[index];
        
        if (result.status === 'fulfilled') {
          syncedCount++;
          console.log(`   ✅ Synced successfully`);
        } else {
          const errorMessage = result.reason instanceof Error 
            ? result.reason.message 
            : String(result.reason);
          
          failedMembers.push({
            id: member.id,
            name: `${member.firstName} ${member.lastName}`,
            error: errorMessage
          });
          
          console.error(`   ❌ Error syncing:`, errorMessage);
        }
      });

      // Notificar progreso
      if (onProgress) {
        onProgress(Math.min(i + batchSize, membersToProcess.length), membersToProcess.length);
      }
    }

    const duration = Date.now() - startTime;

    console.log('\n' + '='.repeat(50));
    console.log(`✅ Migration completed!`);
    console.log(`   Total members: ${allMembers.length}`);
    console.log(`   Members with teachers: ${membersToProcess.length}`);
    console.log(`   Successfully synced: ${syncedCount}`);
    console.log(`   Failed: ${failedMembers.length}`);
    console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
    
    if (failedMembers.length > 0) {
      console.log('\n❌ Failed members:');
      failedMembers.forEach(({ name, error }) => {
        console.log(`   - ${name}: ${error}`);
      });
    }
    
    console.log('='.repeat(50));

    return {
      success: failedMembers.length === 0,
      totalMembers: allMembers.length,
      processedMembers: membersToProcess.length,
      syncedMembers: syncedCount,
      failedMembers,
      duration
    };

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}
