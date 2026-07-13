"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/contexts/i18n-context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";

interface ChangelogEntry {
  version: string;
  date: string;
  changes: {
    es: string[];
    en: string[];
  };
}

interface ChangelogData {
  current: string;
  entries: ChangelogEntry[];
}

export function ChangelogDialog({ children }: { children: React.ReactNode }) {
  const { language, t } = useI18n();
  const [changelog, setChangelog] = useState<ChangelogData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchChangelog = () => {
    setLoading(true);
    fetch(`/changelog.json?v=${Date.now()}`)
      .then((res) => res.json())
      .then((data: ChangelogData) => {
        setChangelog(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchChangelog();
  }, []);

  const lang = language as "es" | "en";

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>

      <DialogContent className="max-w-[95vw] sm:max-w-[425px] w-full max-h-[85vh] flex flex-col gap-3 overflow-hidden p-4 sm:p-6">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("changelog.title")}</DialogTitle>
          <DialogDescription>{t("changelog.description")}</DialogDescription>
        </DialogHeader>

        {/* Explicit max-height so vertical scroll works inside the max-h dialog */}
        <div className="max-h-[calc(85vh-8.5rem)] overflow-y-auto overflow-x-hidden overscroll-contain pr-1">
          <div className="grid gap-4 py-2 max-w-full min-w-0">
            {loading && (
              <p className="text-sm text-muted-foreground">{t("changelog.loading")}</p>
            )}

            {!loading && !changelog && (
              <p className="text-sm text-muted-foreground">{t("changelog.error")}</p>
            )}

            {changelog?.entries.map((entry, index) => (
              <div key={entry.version} className="min-w-0 max-w-full">
                <h3 className="font-semibold">
                  v {entry.version}
                  {index === 0 && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      ({t("changelog.current")})
                    </span>
                  )}
                </h3>
                <p className="text-xs text-muted-foreground mb-1">{entry.date}</p>
                <ul className="list-disc list-outside pl-5 text-sm text-muted-foreground space-y-1">
                  {(entry.changes[lang] ?? entry.changes.es).map((item, i) => (
                    <li
                      key={i}
                      className="break-words [overflow-wrap:anywhere] hyphens-auto"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
