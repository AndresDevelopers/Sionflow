
'use server';

import { getDocs, query, where, Timestamp, orderBy } from 'firebase/firestore';
import {
  convertsCollection,
  futureMembersCollection,
  ministeringCollection,
  activitiesCollection,
  servicesCollection
} from '@/lib/collections';
import type { Convert, FutureMember, Companionship, Activity, Service } from '@/lib/types';
import { subMonths, addDays, format, isAfter, isBefore } from 'date-fns';
import { es } from 'date-fns/locale';

export async function getDashboardData() {
  // 1. Converts Count (last 18 months)
  const eighteenMonthsAgo = subMonths(new Date(), 18);
  const convertsSnapshot = await getDocs(
    query(convertsCollection, where('baptismDate', '>=', Timestamp.fromDate(eighteenMonthsAgo)))
  );
  const convertsCount = convertsSnapshot.size;

  // 2. Future Members Count
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const futureMembersSnapshot = await getDocs(
    query(
      futureMembersCollection,
      where('baptismDate', '>', Timestamp.fromDate(today)),
      where('isBaptized', '==', false)
    )
  );
  const futureMembersCount = futureMembersSnapshot.size;

  const ministeringSnapshot = await getDocs(ministeringCollection);
  const companionships = ministeringSnapshot.docs.map(doc => doc.data() as Companionship);
  
  // 4. Council Actions Count
  // a. Converts needing council
  const councilConvertsSnapshot = await getDocs(query(convertsCollection, where('councilCompleted', '==', false)));
  const pendingCouncilConverts = councilConvertsSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() as Record<string, any> } as Convert))
    .filter(c => c.baptismDate && c.baptismDate.toDate() > eighteenMonthsAgo).length;

  // b. Upcoming baptisms (next 7 days)
  const sevenDaysFromNow = addDays(today, 7);
  const upcomingBaptismsSnapshot = await getDocs(
    query(
      futureMembersCollection,
      where('baptismDate', '>', Timestamp.fromDate(today)),
      where('baptismDate', '<=', Timestamp.fromDate(sevenDaysFromNow)),
      where('isBaptized', '==', false)
    )
  );
  const upcomingBaptismsCount = upcomingBaptismsSnapshot.size;

  // c. Urgent Needs
  const urgentNeedsCount = companionships.flatMap(c => c.families).filter(f => f.isUrgent).length;
  
  // d. Upcoming Services (next 14 days)
  const servicesSnapshot = await getDocs(servicesCollection);
  const services = servicesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as Record<string, any> } as Service));
  const fourteenDaysFromNow = addDays(today, 14);
  const upcomingServicesCount = services.filter(service => {
    const serviceDate = service.date.toDate();
    return isAfter(serviceDate, today) && isBefore(serviceDate, fourteenDaysFromNow);
  }).length;
  
  const councilActionsCount = pendingCouncilConverts + upcomingBaptismsCount + urgentNeedsCount + upcomingServicesCount;
  
  return {
    convertsCount,
    futureMembersCount,
    councilActionsCount,
  };
}


export async function getActivityChartData() {
  const activitiesSnapshot = await getDocs(query(activitiesCollection, orderBy('date', 'asc')));
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

  const englishToSpanish = (name:string) => monthNameMapping[name] || name;

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
