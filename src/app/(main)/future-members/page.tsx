'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Redirect legacy route to Obra Misional → Futuros Miembros tab. */
export default function FutureMembersPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/missionary-work?tab=future_members');
  }, [router]);

  return null;
}
