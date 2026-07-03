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
import { ScrollArea } from "@/components/ui/scroll-area";

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

  useEffect(() => {
    fetch("/changelog.json")
      .then((res) => res.json())
      .then((data: ChangelogData) => {
        setChangelog(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const lang = language as "es" | "en";

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>

      <DialogContent className="w-full h-full max-w-none sm:max-w-[425px] sm:h-auto">
        <DialogHeader>
          <DialogTitle>{t("changelog.title")}</DialogTitle>
          <DialogDescription>{t("changelog.description")}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] sm:max-h-none">
          <div className="grid gap-4 py-4">
            {loading && (
              <p className="text-sm text-muted-foreground">{t("changelog.loading")}</p>
            )}

            {!loading && !changelog && (
              <p className="text-sm text-muted-foreground">{t("changelog.error")}</p>
            )}

            {changelog?.entries.map((entry, index) => (
              <div key={entry.version}>
                <h3 className="font-semibold">
                  v {entry.version}
                  {index === 0 && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      ({t("changelog.current")})
                    </span>
                  )}
                </h3>
                <p className="text-xs text-muted-foreground mb-1">{entry.date}</p>
                <ul className="list-disc list-inside text-sm text-muted-foreground">
                  {(entry.changes[lang] ?? entry.changes.es).map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
