'use client';

import dynamic from 'next/dynamic';

// Dynamically import the client component with no SSR
const ClientOfflineIndicator = dynamic(
    () => import('./client-offline-indicator'),
    { ssr: false }
);

// Simple wrapper component that only renders on the client side
export default function OfflineIndicator() {
    return <ClientOfflineIndicator />;
}
