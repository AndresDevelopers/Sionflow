"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/contexts/i18n-context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  markChangelogSeen,
  shouldShowChangelogBadge,
} from "@/lib/changelog-badge";
import { cn } from "@/lib/utils";

/** Keep a Changelog–style buckets (new format). */
type ChangeCategories = {
  added?: string[];
  improved?: string[];
  fixed?: string[];
};

/** Legacy flat list or categorized object. */
type LocalizedChanges = string[] | ChangeCategories;

interface ChangelogEntry {
  version: string;
  date: string;
  changes: {
    es: LocalizedChanges;
    en: LocalizedChanges;
  };
}

interface ChangelogData {
  current: string;
  entries: ChangelogEntry[];
}

const SECTION_ORDER = ["added", "improved", "fixed"] as const;
type SectionKey = (typeof SECTION_ORDER)[number] | "updates";

const SECTION_STYLE: Record<
  SectionKey,
  { labelKey: string; className: string }
> = {
  added: {
    labelKey: "changelog.section.added",
    className: "text-emerald-600 dark:text-emerald-400",
  },
  improved: {
    labelKey: "changelog.section.improved",
    className: "text-sky-600 dark:text-sky-400",
  },
  fixed: {
    labelKey: "changelog.section.fixed",
    className: "text-amber-600 dark:text-amber-400",
  },
  updates: {
    labelKey: "changelog.section.updates",
    className: "text-muted-foreground",
  },
};

function getSections(
  langChanges: LocalizedChanges | undefined
): { key: SectionKey; items: string[] }[] {
  if (!langChanges) return [];

  if (Array.isArray(langChanges)) {
    return langChanges.length
      ? [{ key: "updates", items: langChanges }]
      : [];
  }

  return SECTION_ORDER.flatMap((key) => {
    const items = langChanges[key];
    if (!Array.isArray(items) || items.length === 0) return [];
    return [{ key, items }];
  });
}

function ChangeList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc list-outside pl-5 text-sm text-muted-foreground space-y-1">
      {items.map((item, i) => (
        <li
          key={i}
          className="break-words [overflow-wrap:anywhere] hyphens-auto"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

export function ChangelogDialog({ children }: { children: React.ReactNode }) {
  const { language, t } = useI18n();
  const [changelog, setChangelog] = useState<ChangelogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const [open, setOpen] = useState(false);
  const versionRef = useRef("");
  const openRef = useRef(false);

  const dismissNew = useCallback((version: string) => {
    if (!version) return;
    markChangelogSeen(version);
    setHasNew(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset de carga antes de sincronizar con fetch externo de changelog.json
    setLoading(true);

    fetch(`/changelog.json?v=${Date.now()}`)
      .then((res) => res.json())
      .then((data: ChangelogData) => {
        if (cancelled) return;
        setChangelog(data);
        versionRef.current = data.current;
        // If the dialog is already open when data arrives, treat as seen.
        if (openRef.current) {
          dismissNew(data.current);
        } else {
          setHasNew(shouldShowChangelogBadge(data.current));
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dismissNew]);

  const handleOpenChange = (nextOpen: boolean) => {
    openRef.current = nextOpen;
    setOpen(nextOpen);
    if (nextOpen && versionRef.current) {
      dismissNew(versionRef.current);
    }
  };

  const lang = language as "es" | "en";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <div className="relative">
          {children}
          {hasNew && (
            <span
              className="absolute right-2.5 top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-sidebar animate-pulse"
              aria-label={t("changelog.new")}
              title={t("changelog.new")}
            />
          )}
        </div>
      </DialogTrigger>

      <DialogContent className="max-w-[95vw] sm:max-w-[425px] w-full max-h-[85vh] flex flex-col gap-3 overflow-hidden p-4 sm:p-6">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("changelog.title")}</DialogTitle>
          <DialogDescription>{t("changelog.description")}</DialogDescription>
        </DialogHeader>

        {/* Explicit max-height so vertical scroll works inside the max-h dialog */}
        <div className="max-h-[calc(85vh-8.5rem)] overflow-y-auto overflow-x-hidden overscroll-contain pr-1">
          <div className="grid gap-5 py-2 max-w-full min-w-0">
            {loading && (
              <p className="text-sm text-muted-foreground">{t("changelog.loading")}</p>
            )}

            {!loading && !changelog && (
              <p className="text-sm text-muted-foreground">{t("changelog.error")}</p>
            )}

            {changelog?.entries.map((entry, index) => {
              const sections = getSections(
                entry.changes[lang] ?? entry.changes.es
              );

              return (
                <div key={entry.version} className="min-w-0 max-w-full space-y-2">
                  <div>
                    <h3 className="font-semibold">
                      v {entry.version}
                      {index === 0 && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          ({t("changelog.current")})
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-muted-foreground">{entry.date}</p>
                  </div>

                  {sections.map((section) => {
                    const style = SECTION_STYLE[section.key];
                    return (
                      <div key={section.key} className="space-y-1">
                        <p
                          className={cn(
                            "text-[11px] font-semibold uppercase tracking-wide",
                            style.className
                          )}
                        >
                          {t(style.labelKey)}
                        </p>
                        <ChangeList items={section.items} />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
