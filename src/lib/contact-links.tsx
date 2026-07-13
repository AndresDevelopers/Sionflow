"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MapPin, MessageSquare, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/contexts/i18n-context";

/**
 * Strips non-digit characters from a phone number for tel: / sms: links.
 */
function stripPhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Formats a phone number as international digits (no "+").
 * Defaults to +593 (Ecuador) when the number looks local.
 */
function toInternationalDigits(phone: string, defaultCountry = "593"): string {
  const cleaned = stripPhone(phone);
  if (!cleaned) return "";

  if (phone.trim().startsWith("+")) return cleaned;
  if (cleaned.startsWith(defaultCountry)) return cleaned;

  // Local formats: 09XXXXXXXX or 9XXXXXXXX
  if (cleaned.startsWith("0") && cleaned.length >= 9) {
    return defaultCountry + cleaned.replace(/^0+/, "");
  }
  if (cleaned.length === 9 || cleaned.length === 10) {
    return defaultCountry + cleaned.replace(/^0+/, "");
  }

  return cleaned;
}

type DeviceKind = "mobile" | "desktop";

function detectDeviceKind(): DeviceKind {
  if (typeof navigator === "undefined") return "desktop";

  const ua = navigator.userAgent || "";
  const isMobileUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(
    ua
  );
  const coarsePointer =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const smallTouch =
    typeof window !== "undefined" &&
    navigator.maxTouchPoints > 0 &&
    window.innerWidth < 1024;

  return isMobileUa || coarsePointer || smallTouch ? "mobile" : "desktop";
}

type ContactAppId = "sms" | "whatsapp" | "telegram";

interface ContactAppAction {
  id: ContactAppId;
  href: string;
  /** Open in a new tab (web fallbacks). Deep links stay in-page. */
  external: boolean;
  labelKey: string;
  icon: ReactNode;
  className: string;
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

/**
 * Builds contact actions available for the current device.
 *
 * Browsers cannot enumerate third-party installed apps (privacy restriction).
 * We detect device capabilities (mobile vs desktop, tel/sms support) and expose
 * deep links so the OS opens the matching app when it is installed.
 *
 * Note: TikTok, Instagram, etc. do not support opening a chat by phone number.
 */
function buildContactApps(
  phone: string,
  device: DeviceKind
): ContactAppAction[] {
  const localDigits = stripPhone(phone);
  const intlDigits = toInternationalDigits(phone);
  if (!localDigits && !intlDigits) return [];

  const telTarget = localDigits || intlDigits;
  const waTarget = intlDigits || localDigits;
  const isMobile = device === "mobile";
  const apps: ContactAppAction[] = [];

  // SMS is primarily useful on phones (the number itself is already a tel: link)
  if (isMobile) {
    apps.push({
      id: "sms",
      href: `sms:${telTarget}`,
      external: false,
      labelKey: "contact.sms",
      icon: <MessageSquare className="h-3.5 w-3.5" />,
      className:
        "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
    });
  }

  // WhatsApp: deep link / web fallback via wa.me (opens the app if installed)
  apps.push({
    id: "whatsapp",
    href: `https://wa.me/${waTarget}`,
    external: true,
    labelKey: "contact.whatsapp",
    icon: <WhatsAppIcon className="h-3.5 w-3.5" />,
    className:
      "bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-400 dark:hover:bg-green-900/60",
  });

  // Telegram: only useful on mobile with the native scheme (chat by phone number)
  if (isMobile) {
    apps.push({
      id: "telegram",
      href: `tg://resolve?phone=${waTarget}`,
      external: false,
      labelKey: "contact.telegram",
      icon: <TelegramIcon className="h-3.5 w-3.5" />,
      className:
        "bg-sky-100 text-sky-700 hover:bg-sky-200 dark:bg-sky-900/40 dark:text-sky-300 dark:hover:bg-sky-900/60",
    });
  }

  return apps;
}

export interface ContactLinkProps {
  value: string;
  className?: string;
}

export function PhoneLink({ value, className }: ContactLinkProps) {
  const { t } = useI18n();
  const [device, setDevice] = useState<DeviceKind>("desktop");

  useEffect(() => {
    setDevice(detectDeviceKind());

    const onResize = () => setDevice(detectDeviceKind());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const apps = useMemo(() => buildContactApps(value, device), [value, device]);

  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-muted-foreground", className)}>
      <Phone className="h-3.5 w-3.5 shrink-0" />
      <a
        href={`tel:${stripPhone(value)}`}
        className="text-sm text-primary hover:underline hover:text-primary/80 transition-colors"
        aria-label={t("contact.callNumber", { number: value })}
      >
        {value}
      </a>

      {apps.length > 0 && (
        <TooltipProvider delayDuration={250}>
          <div
            className="flex items-center gap-1.5"
            role="group"
            aria-label={t("contact.quickActions")}
          >
            {apps.map((app) => (
              <Tooltip key={app.id}>
                <TooltipTrigger asChild>
                  <a
                    href={app.href}
                    {...(app.external
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      app.className
                    )}
                    aria-label={t(app.labelKey, { number: value })}
                  >
                    {app.icon}
                  </a>
                </TooltipTrigger>
                <TooltipContent side="top">{t(app.labelKey, { number: value })}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}

export function AddressLink({ value, className }: ContactLinkProps) {
  const { t } = useI18n();
  const encoded = encodeURIComponent(value);

  return (
    <div className={cn("flex items-start gap-2 text-muted-foreground", className)}>
      <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <a
        href={`https://www.google.com/maps/search/${encoded}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-primary hover:underline hover:text-primary/80 transition-colors"
        aria-label={t("contact.viewAddress", { address: value })}
      >
        {value}
      </a>
    </div>
  );
}
