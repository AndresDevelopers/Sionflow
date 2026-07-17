"use client";

import { useEffect, useState } from "react";
import { doc } from 'firebase/firestore';
import { getDoc } from '@/lib/firestore-query';
import { firestore } from "@/lib/firebase";
import { useI18n } from "@/contexts/i18n-context";
import { Heart, ExternalLink, Download } from "lucide-react";
import Image from "next/image";
import { getAppName } from "@/lib/app-config";

type DonateConfig = {
  donateLink: string;
  qrImageUrl: string;
};

export default function DonatePage() {
  const { t } = useI18n();
  const [config, setConfig] = useState<DonateConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const docRef = doc(firestore, "c_donate_config", "global");
        const snapshot = await getDoc(docRef);

        if (snapshot.exists()) {
          const data = snapshot.data() as DonateConfig;
          setConfig(data);
        } else {
          console.warn("[donate] No donation config document found at c_donate_config/global");
        }
      } catch (error) {
        console.error("[donate] Failed to load donation config:", error);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">{t("donate.loading")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-destructive">{t("donate.error")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-8 px-4 py-12">
      <div className="text-center space-y-4">
        <div className="flex items-center justify-center gap-2">
          <Heart className="h-8 w-8 text-red-500" />
          <h1 className="text-3xl font-bold tracking-tight">
            {t("donate.title").replace("{appName}", getAppName())}
          </h1>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          {t("donate.description")}
        </p>
        <p className="text-sm text-muted-foreground italic">
          {t("donate.optional")}
        </p>

        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50 p-4 text-sm text-amber-800 dark:text-amber-200">
          <p className="leading-relaxed">
            {t("donate.suggestedNote")}
          </p>
        </div>
      </div>

      {config?.qrImageUrl && (
        <div className="flex flex-col items-center space-y-4 rounded-lg border bg-card p-6 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">
            {t("donate.scanQR")}
          </p>
          <div className="relative h-64 w-64 overflow-hidden rounded-lg border">
            <Image
              src={config.qrImageUrl}
              alt="QR code para donar"
              fill
              sizes="256px"
              className="object-contain"
            />
          </div>
          <a
            href={`/api/download-qr?url=${encodeURIComponent(config.qrImageUrl)}`}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Download className="h-4 w-4" />
            {t("donate.downloadQR")}
          </a>
        </div>
      )}

      {config?.donateLink ? (
        <div className="flex flex-col items-center space-y-4 rounded-lg border bg-card p-6 shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">
            {t("donate.orClickLink")}
          </p>
          <a
            href={config.donateLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
            {t("donate.linkText")}
          </a>
        </div>
      ) : (
        !config?.qrImageUrl && (
          <div className="text-center py-8">
            <p className="text-muted-foreground">{t("donate.noLink")}</p>
          </div>
        )
      )}
    </div>
  );
}
