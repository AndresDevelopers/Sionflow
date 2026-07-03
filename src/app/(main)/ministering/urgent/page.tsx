'use client';
import dynamic from 'next/dynamic';

const UrgentNeedsClient = dynamic(() => import('./urgentClient').then(m => m.UrgentNeedsClient), { ssr: false });

export default function UrgentNeedsPage() {
  return <UrgentNeedsClient />;
}
