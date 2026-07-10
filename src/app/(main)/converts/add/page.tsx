'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/contexts/i18n-context';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Los conversos ya no se crean manualmente: se derivan de la fecha de bautismo del miembro.
 * Redirige a la ficha de miembros.
 */
export default function AddConvertPage() {
  const router = useRouter();
  const { t } = useI18n();

  useEffect(() => {
    router.replace('/members');
  }, [router]);

  return (
    <div className="space-y-3 p-6">
      <p className="text-sm text-muted-foreground">
        {t('converts.redirectToMembers') || 'Los conversos se gestionan desde Miembros (fecha de bautismo).'}
      </p>
      <Skeleton className="h-10 w-1/3" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
