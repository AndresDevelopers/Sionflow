'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { parseMemberIdFromConvertId } from '@/lib/converts-from-members';
import { buildMemberEditUrl } from '@/lib/navigation';
import { useI18n } from '@/contexts/i18n-context';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Edición de converso = editar el miembro (fecha de bautismo y datos del miembro).
 */
export default function EditConvertPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useI18n();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;

  useEffect(() => {
    if (!rawId) {
      router.replace('/converts');
      return;
    }
    const memberId = parseMemberIdFromConvertId(rawId) || rawId;
    router.replace(buildMemberEditUrl(memberId, '/converts'));
  }, [rawId, router]);

  return (
    <div className="space-y-3 p-6">
      <p className="text-sm text-muted-foreground">
        {t('converts.redirectToMembers') || 'Redirigiendo a la ficha del miembro…'}
      </p>
      <Skeleton className="h-10 w-1/3" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
