"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/contexts/i18n-context";
import { Wand2 } from "lucide-react";

export function AiSummary({
  summaryText,
  isLoading,
}: {
  summaryText: string;
  isLoading: boolean;
}) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-primary" />
          <span>{t("AI-Generated Summary")}</span>
        </CardTitle>
        <CardDescription>
          {t("An intelligent summary of your quorum's current status.")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-[250px]" />
            <Skeleton className="h-4 w-[200px]" />
            <Skeleton className="h-4 w-[230px]" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {summaryText}
          </p>
        )}
      </CardContent>
    </Card>
  );
}