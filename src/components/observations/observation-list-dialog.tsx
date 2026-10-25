'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useI18n } from '@/contexts/i18n-context';

/** Records shown per page in observation list dialogs (keeps reads/render light). */
export const OBSERVATION_LIST_PAGE_SIZE = 15;

interface ObservationListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  icon: LucideIcon;
  iconClassName?: string;
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  emptyText: string;
  loading?: boolean;
  /** Optional header action (e.g. "Add person" on the health list) */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Paginated list dialog for the observations page.
 * Only the rows for the current page are mounted; data comes from the locally
 * cached snapshot so opening a list never triggers an extra database read.
 */
export function ObservationListDialog({
  open,
  onOpenChange,
  title,
  description,
  icon: Icon,
  iconClassName,
  total,
  page,
  onPageChange,
  emptyText,
  loading = false,
  actions,
  children,
}: ObservationListDialogProps) {
  const { t } = useI18n();
  const totalPages = Math.max(1, Math.ceil(total / OBSERVATION_LIST_PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * OBSERVATION_LIST_PAGE_SIZE + 1;
  const to = Math.min(page * OBSERVATION_LIST_PAGE_SIZE, total);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] w-full max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 pb-3 pt-6 pr-12">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <DialogTitle className="flex items-center gap-2">
                <Icon className={`h-5 w-5 ${iconClassName ?? ''}`} />
                {title}
              </DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </div>
            {actions}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6">
          {loading ? (
            <div className="space-y-3 py-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : total === 0 ? (
            <div className="py-12 text-center">
              <Icon className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground">{emptyText}</p>
            </div>
          ) : (
            <div className="divide-y">{children}</div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-6 py-3">
          <p className="text-xs text-muted-foreground">
            {t('observations.list.range', { from, to, total })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              title={t('observations.list.previous')}
              aria-label={t('observations.list.previous')}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground">
              {t('observations.list.page', { page, totalPages })}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              title={t('observations.list.next')}
              aria-label={t('observations.list.next')}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
