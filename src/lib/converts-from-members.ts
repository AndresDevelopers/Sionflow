/**
 * Conversos recientes: fuente de verdad = c_miembros.baptismDate (últimos 24 meses).
 * Ya no se usan registros manuales en c_conversos.
 */

import { Timestamp } from 'firebase/firestore';
import type { Convert, Member } from '@/lib/types';
import { normalizeMemberStatus } from '@/lib/members-data';

export const RECENT_CONVERT_MONTHS = 24;

export function memberToConvertId(memberId: string): string {
  return `member_${memberId}`;
}

export function parseMemberIdFromConvertId(convertId: string): string | null {
  if (convertId.startsWith('member_')) {
    return convertId.slice('member_'.length) || null;
  }
  return null;
}

/** Fecha de bautismo del miembro como Date, o null. */
export function getMemberBaptismDate(member: Pick<Member, 'baptismDate'> | null | undefined): Date | null {
  if (!member?.baptismDate) return null;
  const bd = member.baptismDate as Timestamp | Date;
  if (typeof (bd as Timestamp).toDate === 'function') {
    return (bd as Timestamp).toDate();
  }
  if (bd instanceof Date) return bd;
  return null;
}

export function getRecentConvertCutoff(now = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - RECENT_CONVERT_MONTHS);
  return cutoff;
}

/**
 * ¿El miembro es converso reciente por su fecha de bautismo?
 * (no fallecido, con baptismDate dentro de los últimos 24 meses)
 */
export function isRecentConvertMember(
  member: Pick<Member, 'baptismDate' | 'status'> | null | undefined,
  now = new Date()
): boolean {
  if (!member) return false;
  if (normalizeMemberStatus(member.status) === 'deceased') return false;
  const baptismDate = getMemberBaptismDate(member);
  if (!baptismDate) return false;
  return baptismDate > getRecentConvertCutoff(now);
}

/** URL de foto de perfil usable (string no vacío). */
export function getMemberPhotoURL(
  source: { photoURL?: string | null } | null | undefined
): string | undefined {
  const url = source?.photoURL;
  if (typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Convierte un miembro con bautismo reciente al shape Convert usado en UI. */
export function memberToConvert(member: Member): Convert {
  return {
    id: memberToConvertId(member.id),
    name: `${member.firstName || ''} ${member.lastName || ''}`.trim(),
    baptismDate: member.baptismDate!,
    photoURL: getMemberPhotoURL(member),
    councilCompleted: (member as Member & { councilCompleted?: boolean }).councilCompleted || false,
    councilCompletedAt: (member as Member & { councilCompletedAt?: Timestamp | null }).councilCompletedAt || null,
    observation: 'Bautizado como miembro',
    missionaryReference: 'Registro de miembros',
    memberId: member.id,
  };
}

/** Filtra y ordena miembros → conversos recientes (más reciente primero). */
export function membersToRecentConverts(members: Member[], now = new Date()): Convert[] {
  return members
    .filter((m) => isRecentConvertMember(m, now))
    .map(memberToConvert)
    .sort(
      (a, b) =>
        b.baptismDate.toDate().getTime() - a.baptismDate.toDate().getTime()
    );
}
