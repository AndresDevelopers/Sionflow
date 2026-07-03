"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { enUS, es } from "date-fns/locale";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { useI18n } from "@/contexts/i18n-context";
import { useToast } from "@/hooks/use-toast";
import logger from "@/lib/logger";
import { fetchBirthdays } from "@/lib/birthdays-data";
import type { BirthdaysOverview } from "@/lib/birthdays-utils";
import { getBirthdaysOverview } from "@/lib/birthdays-utils";

export function BirthdaysDashboardCard() {
  const { user, loading: authLoading, barrioOrg } = useAuth();
  const { language, t } = useI18n();
  const { toast } = useToast();

  const [overview, setOverview] = useState<BirthdaysOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || !user) return;

    let isMounted = true;

    async function load() {
      setLoading(true);
      try {
        const birthdays = await fetchBirthdays(barrioOrg);
        const nextOverview = getBirthdaysOverview(birthdays);
        if (isMounted) setOverview(nextOverview);
      } catch (error) {
        logger.error({ error, message: "Failed to load birthdays overview" });
        toast({
          title: t("birthdays.error"),
          description: t("birthdays.loadError"),
          variant: "destructive",
        });
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    queueMicrotask(() => {
      void load();
    });

    return () => {
      isMounted = false;
    };
  }, [authLoading, toast, t, user]);

  const currentLocale = language === "es" ? es : enUS;
  const formatDate = (date: Date) => format(date, "d LLL yyyy", { locale: currentLocale });

  const hasData = Boolean((overview?.today.length ?? 0) > 0 || (overview?.upcoming.length ?? 0) > 0);

  const getMemberStatusLabel = (status: string | undefined) => {
    if (!status) return null;
    return t(`member.status.${status}`);
  };

  return (
    <Link href="/birthdays" className="lg:col-start-3">
      <Card>
        <CardHeader>
          <CardTitle>{t("birthdays.dashboardTitle")}</CardTitle>
          <CardDescription>{t("birthdays.dashboardDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : !hasData ? (
            <p className="text-sm text-muted-foreground">{t("birthdays.dashboardNone")}</p>
          ) : (
            <>
              <div className="space-y-2">
                <p className="text-sm font-medium">{t("birthdays.dashboardTodayLabel")}</p>
                {(overview?.today.length ?? 0) > 0 ? (
                  <div className="space-y-2">
                    {overview?.today.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{item.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.turnsAge === null
                              ? t("birthdays.dashboardAgeUnknown")
                              : t("birthdays.dashboardTurnsAge").replace("{age}", String(item.turnsAge))}
                          </p>
                          {item.isMember ? (
                            <p className="text-xs text-muted-foreground">
                              {getMemberStatusLabel(item.memberStatus) ?? t("birthdays.dashboardStatusUnknown")}
                            </p>
                          ) : null}
                        </div>
                        <Badge variant="secondary">{t("birthdays.dashboardTodayBadge")}</Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("birthdays.dashboardNoToday")}</p>
                )}
              </div>

              <div className="space-y-2 border-t pt-4">
                <p className="text-sm font-medium">{t("birthdays.dashboardUpcomingLabel")}</p>
                {(overview?.upcoming.length ?? 0) > 0 ? (
                  <div className="space-y-2">
                    {overview?.upcoming.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{item.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.turnsAge === null
                              ? t("birthdays.dashboardAgeUnknown")
                              : t("birthdays.dashboardTurnsAge").replace("{age}", String(item.turnsAge))}
                          </p>
                          {item.isMember ? (
                            <p className="text-xs text-muted-foreground">
                              {getMemberStatusLabel(item.memberStatus) ?? t("birthdays.dashboardStatusUnknown")}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant="outline">{formatDate(item.nextBirthday)}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("birthdays.noUpcoming")}</p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
