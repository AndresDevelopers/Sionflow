
import { getDocs, query, where, Timestamp, orderBy } from 'firebase/firestore';
import {
  convertsCollection,
  futureMembersCollection,
  ministeringCollection,
  activitiesCollection,
  servicesCollection,
  membersCollection,
  annotationsCollection
} from '@/lib/collections';
import type { Convert, Companionship, Activity, Service, Member } from '@/lib/types';
import { normalizeMemberStatus } from '@/lib/members-data';
import { buildActivityOverview } from '@/lib/activity-overview';
import { subMonths, addDays, format, isAfter, isBefore } from 'date-fns';
import { es } from 'date-fns/locale';

export async function getFutureMembers(barrioOrg: string): Promise<Member[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const snapshot = await getDocs(query(membersCollection, where('barrioOrg', '==', barrioOrg)));

  const futureMembers = snapshot.docs
    .map(doc => {
      const memberData = doc.data();
      return {
        id: doc.id,
        ...memberData,
        status: normalizeMemberStatus(memberData.status),
      } as Member;
    })
    .filter(member => {
      if (member.status === 'deceased') return false;
      const isBaptized = member.ordinances?.includes('baptism') ?? false;
      const hasFutureBaptism = member.baptismDate && member.baptismDate.toDate() > today;
      return !isBaptized && hasFutureBaptism;
    })
    .sort((a, b) => {
      if (!a.baptismDate || !b.baptismDate) return 0;
      return a.baptismDate.toMillis() - b.baptismDate.toMillis();
    });

  return futureMembers;
}

export async function getDashboardData(barrioOrg: string) {
  // 1. Conversos Totales (últimos 24 meses, igual que la página de conversos)
  const twentyFourMonthsAgo = subMonths(new Date(), 24);
  const twentyFourMonthsAgoTimestamp = Timestamp.fromDate(twentyFourMonthsAgo);

  // Conversos de la colección
  const convertsSnapshot = await getDocs(query(convertsCollection, where('barrioOrg', '==', barrioOrg), orderBy('baptismDate', 'desc')));
  const convertsFromCollection = convertsSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() } as Convert))
    .filter(convert => 
      convert.baptismDate && 
      convert.baptismDate.toDate &&
      convert.baptismDate.toDate() > twentyFourMonthsAgo
    );

  // Miembros bautizados hace menos de 24 meses
  const membersSnapshot = await getDocs(query(membersCollection, where('barrioOrg', '==', barrioOrg), orderBy('baptismDate', 'desc')));
  const membersAsConverts = membersSnapshot.docs
    .map(doc => {
      const memberData = doc.data();
      if (memberData.baptismDate && memberData.baptismDate.toDate) {
        const baptismDate = memberData.baptismDate.toDate();
        if (baptismDate > twentyFourMonthsAgo) {
          return {
            id: `member_${doc.id}`,
            name: `${memberData.firstName} ${memberData.lastName}`,
            baptismDate: memberData.baptismDate,
            photoURL: memberData.photoURL,
            councilCompleted: memberData.councilCompleted || false,
            councilCompletedAt: memberData.councilCompletedAt || null,
            observation: 'Bautizado como miembro',
            missionaryReference: 'Registro de miembros'
          } as Convert;
        }
      }
      return null;
    })
    .filter(Boolean) as Convert[];

  // Combinar y ordenar por fecha de bautismo (más reciente primero)
  const allConverts = [...convertsFromCollection, ...membersAsConverts]
    .sort((a, b) => b.baptismDate.toDate().getTime() - a.baptismDate.toDate().getTime());

  // Eliminar duplicados basados en nombre y fecha de bautismo
  const uniqueConverts = allConverts.filter((convert, index, self) => 
    index === self.findIndex(c => 
      c.name === convert.name && 
      c.baptismDate.toDate().getTime() === convert.baptismDate.toDate().getTime()
    )
  );

  const convertsCount = uniqueConverts.length;

  // 2. Future Members Count
  const futureMembers = await getFutureMembers(barrioOrg);
  const futureMembersCount = futureMembers.length;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const ministeringSnapshot = await getDocs(query(ministeringCollection, where('barrioOrg', '==', barrioOrg)));
  const companionships = ministeringSnapshot.docs.map(doc => doc.data() as Companionship);

  // 4. Council Actions Count - Based on active items in Council page

  // a. Unresolved annotations for council
  const councilAnnotationsSnapshot = await getDocs(
    query(annotationsCollection, where('barrioOrg', '==', barrioOrg), where('isResolved', '==', false))
  );
  const councilAnnotationsCount = councilAnnotationsSnapshot.size;

  // b. Services not notified to council
  const servicesSnapshot = await getDocs(
    query(servicesCollection, where('barrioOrg', '==', barrioOrg), where('date', '>=', Timestamp.fromDate(today)))
  );
  const services = servicesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Service));
  const servicesNotNotifiedCount = services.filter(service =>
    service.councilNotified === false || service.councilNotified === undefined
  ).length;

  // c. Converts needing council follow-up (within 18 months, not completed)
  const councilConvertsSnapshot = await getDocs(query(convertsCollection, where('barrioOrg', '==', barrioOrg), where('councilCompleted', '==', false)));
  const pendingCouncilConverts = councilConvertsSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() } as Convert))
  .filter(c => c.baptismDate && c.baptismDate.toDate() > twentyFourMonthsAgo).length;

  // d. Upcoming baptisms (next 7 days)
  const sevenDaysFromNow = addDays(today, 7);
  const upcomingBaptismsSnapshot = await getDocs(
    query(
      futureMembersCollection,
      where('barrioOrg', '==', barrioOrg),
      where('baptismDate', '>=', Timestamp.fromDate(today)),
      where('baptismDate', '<=', Timestamp.fromDate(sevenDaysFromNow))
    )
  );
  const upcomingBaptismsCount = upcomingBaptismsSnapshot.size;

  // e. Upcoming activities (next 14 days)
  const fourteenDaysFromNow = addDays(today, 14);
  const activitiesSnapshot = await getDocs(query(activitiesCollection, where('barrioOrg', '==', barrioOrg), orderBy('date', 'desc')));
  const upcomingActivitiesCount = activitiesSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() } as Activity))
    .filter(activity => {
      const activityDate = activity.date.toDate();
      return isAfter(activityDate, today) && isBefore(activityDate, fourteenDaysFromNow);
    }).length;

  // f. Urgent needs from ministering
  const urgentNeedsCount = companionships.flatMap(c => c.families).filter(f => f.isUrgent).length;

  // g. Less active members needing council follow-up
  const lessActiveMembersSnapshot = await getDocs(
    query(membersCollection, where('barrioOrg', '==', barrioOrg), where('status', '==', 'less_active'))
  );
  const lessActiveMembers = lessActiveMembersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Member));
  const lessActiveMembersNeedingCouncilCount = lessActiveMembers.filter(member =>
    !member.councilCompleted
  ).length;

  const councilActionsCount = councilAnnotationsCount + servicesNotNotifiedCount + pendingCouncilConverts +
    upcomingBaptismsCount + upcomingActivitiesCount + urgentNeedsCount +
    lessActiveMembersNeedingCouncilCount;

  return {
    convertsCount,
    futureMembersCount,
    councilActionsCount,
  };
}

export async function getMembersByStatus(barrioOrg: string) {
  const membersSnapshot = await getDocs(query(membersCollection, where('barrioOrg', '==', barrioOrg)));
  const members = membersSnapshot.docs
    .map(doc => {
      const memberData = doc.data() as Record<string, any>;
      return {
        id: doc.id,
        ...memberData,
        status: normalizeMemberStatus(memberData.status),
      } as Member;
    })
    .filter(member => member.status !== 'deceased');

  const activeMembers = members.filter(m => m.status === 'active');
  const lessActiveMembers = members.filter(m => m.status === 'less_active');
  const inactiveMembers = members.filter(m => m.status === 'inactive');

  return {
    active: activeMembers,
    lessActive: lessActiveMembers,
    inactive: inactiveMembers,
    total: members.length
  };
}

export async function getActivityOverviewData(barrioOrg: string) {
  const activitiesSnapshot = await getDocs(query(activitiesCollection, where('barrioOrg', '==', barrioOrg), orderBy('date', 'asc')));
  const activities = activitiesSnapshot.docs.map((doc) => {
    const activity = doc.data() as Activity;

    return {
      title: activity.title,
      date: activity.date.toDate(),
    };
  });

  return buildActivityOverview(activities);
}


export async function getActivityChartData(barrioOrg: string) {
  const activitiesSnapshot = await getDocs(query(activitiesCollection, where('barrioOrg', '==', barrioOrg), orderBy('date', 'asc')));
  const activities = activitiesSnapshot.docs.map(doc => doc.data() as Activity);

  const monthlyTotals: { [key: string]: number } = {
    Jan: 0, Feb: 0, Mar: 0, Apr: 0, May: 0, Jun: 0,
    Jul: 0, Aug: 0, Sep: 0, Oct: 0, Nov: 0, Dec: 0,
  };

  const currentYear = new Date().getFullYear();

  activities.forEach(activity => {
    const activityDate = activity.date.toDate();
    if (activityDate.getFullYear() === currentYear) {
      const month = format(activityDate, 'MMM', { locale: es });
      // Capitalize first letter for consistency (e.g., 'Ene' -> 'Ene')
      const monthKey = month.charAt(0).toUpperCase() + month.slice(1).replace('.', '');
      if (monthlyTotals.hasOwnProperty(monthKey)) {
        monthlyTotals[monthKey] += 1;
      }
    }
  });

  // Map to the format expected by the chart
  const chartData = Object.entries(monthlyTotals).map(([name, total]) => ({
    name: name,
    total: total,
  }));

  // Re-order to standard month order since locale might change it
  const standardOrder = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const monthNameMapping: { [key: string]: string } = {
    Jan: "Ene", Aug: "Ago", Apr: "Abr", Dec: "Dic"
  };



  const sortedChartData = standardOrder.map(monthName => {
    // Find the English key that maps to the Spanish month name
    const englishKey = Object.keys(monthNameMapping).find(key => monthNameMapping[key] === monthName) || monthName;
    const dataEntry = chartData.find(d => d.name === englishKey || d.name === monthName);
    return {
      name: monthName,
      total: dataEntry ? dataEntry.total : 0,
    }
  });


  return sortedChartData;
}
