import { getDocs, orderBy, query, where } from 'firebase/firestore';
import { birthdaysCollection, membersCollection } from '@/lib/collections';
import logger from '@/lib/logger';
import { normalizeMemberStatus } from '@/lib/members-data';
import type { Birthday, Member } from '@/lib/types';

export async function fetchBirthdays(barrioOrg: string): Promise<Birthday[]> {
  try {
    const birthdaysSnapshot = await getDocs(query(birthdaysCollection, where('barrioOrg', '==', barrioOrg), orderBy('name')));
    const birthdays = birthdaysSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<Birthday, 'id'>) }));

    const membersSnapshot = await getDocs(
      query(membersCollection, where('barrioOrg', '==', barrioOrg), where('birthDate', '!=', null), orderBy('birthDate', 'asc'))
    );

    const memberBirthdays: Birthday[] = membersSnapshot.docs
      .filter((docSnap) => {
        const member = docSnap.data() as Member;
        if (normalizeMemberStatus(member.status) === 'deceased') return false;
        return Boolean(member.birthDate && member.firstName && member.lastName);
      })
      .map((docSnap) => {
        const member = docSnap.data() as Member;
        return {
          id: `member_${docSnap.id}`,
          name: `${member.firstName} ${member.lastName}`,
          birthDate: member.birthDate!,
          photoURL: member.photoURL,
          isMember: true,
          memberId: docSnap.id,
          memberStatus: member.status,
        };
      });

    return [...birthdays, ...memberBirthdays];
  } catch (error) {
    logger.error({ error, message: 'Error fetching birthdays' });

    try {
      const birthdaysSnapshot = await getDocs(query(birthdaysCollection, where('barrioOrg', '==', barrioOrg), orderBy('name')));
      return birthdaysSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<Birthday, 'id'>) }));
    } catch (fallbackError) {
      logger.error({ error: fallbackError, message: 'Error fetching fallback birthdays' });
      return [];
    }
  }
}
