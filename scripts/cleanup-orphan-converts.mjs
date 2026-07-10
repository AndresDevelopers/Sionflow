/**
 * Audita y limpia documentos huérfanos de conversos / bautismos automáticos.
 *
 * NO elimina la colección c_conversos (sigue en uso por la app).
 * Solo elimina registros que ya no corresponden a un miembro con bautismo reciente.
 *
 * Uso:
 *   node scripts/cleanup-orphan-converts.mjs              # dry-run (solo lista)
 *   node scripts/cleanup-orphan-converts.mjs --execute    # borra de verdad
 *
 * Criterios de huérfano (TODOS deben cumplirse según el caso):
 *  A) c_conversos con memberId:
 *     - miembro no existe, O
 *     - miembro fallecido, O
 *     - miembro sin baptismDate, O
 *     - baptismDate del miembro > 24 meses
 *  B) c_conversos automático sin memberId (observation auto):
 *     - existe miembro con el mismo nombre completo Y no es converso reciente
 *  C) c_bautismos source=="Automático" (muy restrictivo; reportes usan histórico):
 *     - el nombre pertenece a un converso huérfano Y el miembro no tiene baptismDate
 *       (o el miembro no existe). Así no se pierden bautismos de años anteriores
 *       que aún alimentan reportes vía c_bautismos o vía el propio miembro.
 *  D) c_conversos_info / c_obra_misional_amigos_conversos:
 *     - solo si su convertId está en la lista de conversos a borrar
 *
 * NUNCA se borran:
 *  - conversos manuales (sin memberId y sin observation automática)
 *  - conversos cuya fecha de miembro es reciente
 *  - bautismos con source distinto de "Automático"
 *  - bautismos automáticos de miembros que AÚN tienen baptismDate (histórico de reportes)
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const EXECUTE = process.argv.includes('--execute');

const serviceAccountPath = resolve(root, 'quorumflow-dlqh0-d46b66e83c09.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
}

const db = getFirestore();
const twentyFourMonthsAgo = new Date();
twentyFourMonthsAgo.setMonth(twentyFourMonthsAgo.getMonth() - 24);

const normalizeName = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const isAutomaticConvert = (data) =>
  data.observation === 'Registrado automáticamente desde Miembros' ||
  data.missionaryReference === 'Registro de miembros';

function memberBaptismDate(member) {
  const bd = member?.baptismDate;
  if (!bd) return null;
  if (typeof bd.toDate === 'function') return bd.toDate();
  if (bd instanceof Date) return bd;
  if (bd._seconds != null) return new Date(bd._seconds * 1000);
  return null;
}

function isRecentConvertMember(member) {
  if (!member) return false;
  const status = String(member.status || '').toLowerCase();
  if (['deceased', 'fallecido', 'fallecida'].includes(status)) return false;
  const d = memberBaptismDate(member);
  if (!d) return false;
  return d > twentyFourMonthsAgo;
}

async function loadCollection(name) {
  const snap = await db.collection(name).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function main() {
  console.log('=== Cleanup huérfanos conversos/bautismos ===');
  console.log(`Modo: ${EXECUTE ? 'EXECUTE (borra)' : 'DRY-RUN (solo lista)'}`);
  console.log(`Corte 24 meses: ${twentyFourMonthsAgo.toISOString()}\n`);

  const [converts, members, baptisms, convertInfos, friendships] = await Promise.all([
    loadCollection('c_conversos'),
    loadCollection('c_miembros'),
    loadCollection('c_bautismos'),
    loadCollection('c_conversos_info'),
    loadCollection('c_obra_misional_amigos_conversos'),
  ]);

  const membersById = new Map(members.map((m) => [m.id, m]));
  const membersByName = new Map();
  for (const m of members) {
    const full = normalizeName(`${m.firstName || ''} ${m.lastName || ''}`);
    if (full) membersByName.set(full, m);
  }

  /** @type {{ id: string, reason: string, name?: string, memberId?: string, barrioOrg?: string }[]} */
  const orphanConverts = [];
  /** @type {{ id: string, reason: string, name?: string }[]} */
  const keepConverts = [];

  for (const c of converts) {
    const name = c.name || '';
    const memberId = (c.memberId || '').trim();
    const auto = isAutomaticConvert(c);

    if (memberId) {
      const member = membersById.get(memberId);
      if (!member) {
        orphanConverts.push({
          id: c.id,
          reason: 'memberId apunta a miembro inexistente',
          name,
          memberId,
          barrioOrg: c.barrioOrg,
        });
        continue;
      }
      if (isRecentConvertMember(member)) {
        keepConverts.push({
          id: c.id,
          reason: 'miembro con bautismo reciente',
          name,
        });
        continue;
      }
      const bd = memberBaptismDate(member);
      orphanConverts.push({
        id: c.id,
        reason: !bd
          ? 'miembro sin fecha de bautismo'
          : ['deceased', 'fallecido', 'fallecida'].includes(String(member.status || '').toLowerCase())
            ? 'miembro fallecido'
            : 'bautismo del miembro fuera de 24 meses',
        name,
        memberId,
        barrioOrg: c.barrioOrg,
      });
      continue;
    }

    // Sin memberId
    if (auto) {
      const member = membersByName.get(normalizeName(name));
      if (member && !isRecentConvertMember(member)) {
        orphanConverts.push({
          id: c.id,
          reason: 'automático: nombre coincide con miembro sin bautismo reciente',
          name,
          memberId: member.id,
          barrioOrg: c.barrioOrg,
        });
        continue;
      }
      if (member && isRecentConvertMember(member)) {
        keepConverts.push({
          id: c.id,
          reason: 'automático con miembro reciente (falta memberId, se conserva)',
          name,
        });
        continue;
      }
      // Automático sin miembro homónimo: no borrar (podría ser registro legítimo huérfano de datos)
      keepConverts.push({
        id: c.id,
        reason: 'automático sin miembro homónimo — se conserva por seguridad',
        name,
      });
      continue;
    }

    // Manual sin memberId: NUNCA borrar
    keepConverts.push({
      id: c.id,
      reason: 'converso manual (sin memberId) — se conserva',
      name,
    });
  }

  const orphanConvertIds = new Set(orphanConverts.map((o) => o.id));
  const orphanConvertNames = new Set(
    orphanConverts.map((o) => normalizeName(o.name)).filter(Boolean)
  );

  // Bautismos automáticos: solo si el miembro ya no tiene baptismDate (o no existe)
  // y el nombre está entre conversos huérfanos. No borrar históricos de reportes.
  const orphanBaptisms = [];
  const keepBaptisms = [];
  for (const b of baptisms) {
    const source = b.source || '';
    const name = b.name || '';
    const nName = normalizeName(name);

    if (source !== 'Automático') {
      keepBaptisms.push({ id: b.id, reason: `source="${source || '(vacío)'}" no automático`, name });
      continue;
    }

    if (!orphanConvertNames.has(nName)) {
      keepBaptisms.push({
        id: b.id,
        reason: 'bautismo automático sin converso huérfano asociado — se conserva',
        name,
      });
      continue;
    }

    const member = membersByName.get(nName);
    if (!member) {
      orphanBaptisms.push({
        id: b.id,
        reason: 'bautismo automático de converso huérfano sin miembro',
        name,
      });
      continue;
    }

    const bd = memberBaptismDate(member);
    if (!bd) {
      orphanBaptisms.push({
        id: b.id,
        reason: 'bautismo automático de miembro sin fecha de bautismo',
        name,
      });
      continue;
    }

    // Miembro aún tiene baptismDate → conservar para reportes / histórico
    keepBaptisms.push({
      id: b.id,
      reason: 'miembro aún tiene baptismDate (histórico de reportes) — se conserva',
      name,
    });
  }

  // Info y amistades solo si el convert se borra
  const orphanInfos = convertInfos
    .filter((i) => orphanConvertIds.has(i.id))
    .map((i) => ({ id: i.id, reason: 'info de converso huérfano' }));

  const orphanFriendships = friendships
    .filter((f) => f.convertId && orphanConvertIds.has(f.convertId))
    .map((f) => ({
      id: f.id,
      reason: `amistad de converso huérfano ${f.convertId}`,
      convertId: f.convertId,
    }));

  console.log('--- RESUMEN ---');
  console.log(`c_conversos total: ${converts.length}`);
  console.log(`  a CONSERVAR: ${keepConverts.length}`);
  console.log(`  HUÉRFANOS a borrar: ${orphanConverts.length}`);
  console.log(`c_bautismos total: ${baptisms.length}`);
  console.log(`  a CONSERVAR: ${keepBaptisms.length}`);
  console.log(`  HUÉRFANOS a borrar: ${orphanBaptisms.length}`);
  console.log(`c_conversos_info huérfanos: ${orphanInfos.length}`);
  console.log(`c_obra_misional_amigos_conversos huérfanos: ${orphanFriendships.length}`);
  console.log('');

  if (orphanConverts.length) {
    console.log('--- CONVERSOS HUÉRFANOS ---');
    for (const o of orphanConverts) {
      console.log(
        `  [${o.id}] ${o.name || '(sin nombre)'} | ${o.reason}` +
          (o.memberId ? ` | memberId=${o.memberId}` : '') +
          (o.barrioOrg ? ` | barrio=${o.barrioOrg}` : '')
      );
    }
    console.log('');
  }

  if (orphanBaptisms.length) {
    console.log('--- BAUTISMOS AUTOMÁTICOS HUÉRFANOS ---');
    for (const o of orphanBaptisms) {
      console.log(`  [${o.id}] ${o.name || '(sin nombre)'} | ${o.reason}`);
    }
    console.log('');
  }

  if (orphanInfos.length) {
    console.log('--- INFO CONVERSOS HUÉRFANA ---');
    for (const o of orphanInfos) {
      console.log(`  [${o.id}] ${o.reason}`);
    }
    console.log('');
  }

  if (orphanFriendships.length) {
    console.log('--- AMISTADES HUÉRFANAS ---');
    for (const o of orphanFriendships) {
      console.log(`  [${o.id}] ${o.reason}`);
    }
    console.log('');
  }

  const totalToDelete =
    orphanConverts.length +
    orphanBaptisms.length +
    orphanInfos.length +
    orphanFriendships.length;

  if (totalToDelete === 0) {
    console.log('No hay documentos huérfanos que borrar. Listo.');
    return;
  }

  if (!EXECUTE) {
    console.log(
      `Dry-run: ${totalToDelete} documento(s) se borrarían. Re-ejecuta con --execute para aplicar.`
    );
    return;
  }

  console.log(`Borrando ${totalToDelete} documento(s)...`);
  const batchSize = 400;
  let batch = db.batch();
  let ops = 0;
  let deleted = 0;

  const enqueue = async (ref) => {
    batch.delete(ref);
    ops += 1;
    deleted += 1;
    if (ops >= batchSize) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  };

  for (const o of orphanConverts) {
    await enqueue(db.collection('c_conversos').doc(o.id));
  }
  for (const o of orphanBaptisms) {
    await enqueue(db.collection('c_bautismos').doc(o.id));
  }
  for (const o of orphanInfos) {
    await enqueue(db.collection('c_conversos_info').doc(o.id));
  }
  for (const o of orphanFriendships) {
    await enqueue(db.collection('c_obra_misional_amigos_conversos').doc(o.id));
  }

  if (ops > 0) {
    await batch.commit();
  }

  console.log(`Listo. Eliminados: ${deleted}`);
}

main().catch((err) => {
  console.error('Error en cleanup:', err);
  process.exit(1);
});
