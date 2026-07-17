"use client";

import { type ReactNode, useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Heart, LogOut, Settings, RefreshCw, Shield, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  SidebarFooter,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LanguageSwitcher } from "@/components/language-switcher";
import Image from "next/image";
import { useI18n } from "@/contexts/i18n-context";
import { useAuth } from "@/contexts/auth-context";
import { useRefresh } from "@/contexts/refresh-context";
import { auth } from "@/lib/firebase";
import OfflineIndicator from "@/components/offline-indicator";
import { PushForegroundListener } from "@/components/push-foreground-listener";
import { OfflineCacheWarmup } from "@/components/offline-cache-warmup";
import { OfflineRouteCache } from "@/components/offline-route-cache";
import { OfflineShellPrecache } from "@/components/offline-shell-precache";
import { OfflineContentBanner } from "@/components/offline-content-banner";
import { ErrorBoundary } from "@/components/error-boundary";
import { signOut } from "firebase/auth";
import { useToast } from "@/hooks/use-toast";
import { NotificationBell } from "./notification-bell";
import { ChangelogDialog } from "./changelog-dialog";
import { InstallPrompt } from "@/components/install-prompt";
import { PushOnboardingGuide } from "@/components/push-onboarding-guide";
import { OfflineSyncBootstrap } from "@/components/offline-sync-bootstrap";
import { DataSyncListener } from "@/components/data-sync-listener";
import { navigationItems } from "@/lib/navigation";
import { isAdmin } from "@/lib/roles";
import { getAppName, getAppLogo } from "@/lib/app-config";

const appName = getAppName();

function Logo() {
  const { mainPage } = useAuth();
  
  return (
    <Link
      href={mainPage}
      className="flex items-center gap-2 font-semibold text-foreground"
    >
      <Image
        src={getAppLogo()}
        alt={appName}
        width={24}
        height={24}
        className="h-6 w-6"
      />
      <span className="hidden group-data-[state=expanded]:inline">
        {appName}
      </span>
    </Link>
  );
}

function UserNav() {
  const { t } = useI18n();
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

   const handleLogout = async () => {
     try {
       // Mark intentional logout so offline sticky auth does not rehydrate session
       window.dispatchEvent(new Event('sionflow:intent-sign-out'));
       const { syncServerSession } = await import('@/lib/auth-session-client');
       await syncServerSession(null);
       await signOut(auth);
       toast({
         title: t("settings.security.passwordUpdatedTitle"),
         description: t("settings.security.passwordUpdatedDescription"),
       });
       router.push("/login");
     } catch (error) {
       console.error("Logout error", error);
       toast({
         title: t("common.error"),
         description: t("admin.users.toast.errorDelete"),
         variant: "destructive",
       });
     }
   };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-8 w-8 rounded-full">
          <Avatar className="h-8 w-8">
            {user?.photoURL && (
              <AvatarImage
                src={user.photoURL}
                alt={user.displayName ?? "User Avatar"}
                className="rounded-full object-cover"
              />
            )}
            <AvatarFallback>{user?.initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">
              {user?.displayName}
            </p>
            <p className="text-xs leading-none text-muted-foreground">
              {user?.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
          <LanguageSwitcher />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">{t("Profile")}</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">{t("Settings")}</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/donate" className="text-red-500">
            <Heart className="mr-2 h-4 w-4" />
            {t("Donate")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout}>
          <LogOut className="mr-2 h-4 w-4" />
          <span>{t("Log out")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RefreshControls() {
  const { t } = useI18n();
  const { isRefreshing, requestRefresh, lastSyncTime, lastSyncSource } =
    useRefresh();
  const label =
    t("mainLayout.refreshTooltip") ||
    "Actualizar datos (respaldo si falla la sincronización automática)";

  const datetimeLabel = lastSyncTime
    ? format(lastSyncTime, "dd/MM/yyyy HH:mm")
    : null;
  const shortDatetimeLabel = lastSyncTime
    ? format(lastSyncTime, "dd/MM HH:mm")
    : null;
  const sourceLabel =
    lastSyncSource === "manual"
      ? t("syncStatus.manual") || "Manual"
      : lastSyncSource === "automatic"
        ? t("syncStatus.automatic") || "Automática"
        : null;
  const updatedLabel = (() => {
    if (!lastSyncTime || !datetimeLabel) return null;
    if (sourceLabel) {
      return (
        t("syncStatus.updatedWithSource", {
          datetime: datetimeLabel,
          source: sourceLabel,
        }) || `Actualizado ${datetimeLabel} · ${sourceLabel}`
      );
    }
    return (
      t("syncStatus.updated", { datetime: datetimeLabel }) ||
      `Actualizado ${datetimeLabel}`
    );
  })();
  const titleLabel = lastSyncTime
    ? [format(lastSyncTime, "dd/MM/yyyy HH:mm:ss"), sourceLabel]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      {/* Keep last sync label visible; only the button icon spins while refreshing */}
      {lastSyncTime ? (
        <span
          className={`inline-flex max-w-[11rem] items-center gap-1 truncate text-xs sm:max-w-none ${
            isRefreshing ? "text-muted-foreground" : "text-green-600"
          }`}
          title={titleLabel}
        >
          <CheckCircle className="h-3 w-3 shrink-0" />
          <span className="sm:hidden">
            {shortDatetimeLabel}
            {sourceLabel ? ` · ${sourceLabel}` : ""}
          </span>
          <span className="hidden sm:inline">{updatedLabel}</span>
        </span>
      ) : null}

      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                // Always allow click; requestRefresh is re-entrant-safe and
                // offline path finishes in ~2s without blocking the UI forever.
                void requestRefresh();
              }}
              disabled={isRefreshing}
              aria-busy={isRefreshing}
              aria-label={
                isRefreshing
                  ? t("syncStatus.syncing") || "Sincronizando…"
                  : label
              }
            >
              <RefreshCw
                className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>
              {isRefreshing
                ? t("syncStatus.syncing") || "Sincronizando…"
                : label}
              {!isRefreshing && updatedLabel ? ` · ${updatedLabel}` : ""}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

export function MainLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const { setOpenMobile } = useSidebar();
  const { userRole, visiblePages } = useAuth();
  const { refreshGeneration } = useRefresh();
  const [version, setVersion] = useState("");
  const showAdminLink = isAdmin(userRole);

  // Derive nav from auth context — no extra Firestore read
  // Map legacy paths: /future-members → /missionary-work, /reports → /reports/activities
  const visibleNavItems = (() => {
    if (Array.isArray(visiblePages) && visiblePages.length > 0) {
      const normalizedPages = visiblePages.map((p) => {
        if (p === "/future-members") return "/missionary-work";
        if (p === "/reports") return "/reports/activities";
        return p;
      });
      const effectiveAllowed = Array.from(
        new Set([...normalizedPages, "/church-chat"])
      );
      return navigationItems.filter((item) => effectiveAllowed.includes(item.href));
    }
    return navigationItems;
  })();

  useEffect(() => {
    fetch(`/changelog.json?v=${Date.now()}`)
      .then((res) => res.json())
      .then((data) => {
        setVersion(data.current);
      })
      .catch((error) => console.error("Error fetching version:", error));
  }, []);

  const translatedNavItems = visibleNavItems.map((item) => ({
    ...item,
    label: t(item.i18nKey) || item.i18nKey,
  }));

  const handleLinkClick = () => {
    setOpenMobile(false);
  };

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <Logo />
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            {translatedNavItems.map((item) => (
              <SidebarMenuItem key={item.href}>
                <Link href={item.href} onClick={handleLinkClick}>
                  <SidebarMenuButton
                    isActive={
                      item.href === "/"
                        ? pathname === "/"
                        : pathname.startsWith(item.href)
                    }
                    tooltip={{ children: t(item.i18nKey) }}
                  >
                    <item.icon className="h-5 w-5" />
                    <span className="group-data-[collapsible=icon]:hidden">
                      {t(item.i18nKey)}
                    </span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarSeparator />
        <SidebarFooter>
          <ChangelogDialog>
            <div className="cursor-pointer px-4 pb-2 text-xs text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
              v {version}
            </div>
          </ChangelogDialog>
          <SidebarMenu>
            {showAdminLink && (
              <SidebarMenuItem>
                <Link href="/admin" onClick={handleLinkClick}>
                  <SidebarMenuButton
                    isActive={pathname.startsWith("/admin")}
                    tooltip={{ children: t("mainLayout.adminTooltip") }}
                  >
                    <Shield className="h-5 w-5" />
                    <span className="group-data-[collapsible=icon]:hidden">
                      {t("mainLayout.adminTooltip")}
                    </span>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            )}
            <SidebarMenuItem>
              <Link href="/settings" onClick={handleLinkClick}>
                <SidebarMenuButton
                  isActive={pathname.startsWith("/settings")}
                  tooltip={{ children: t("Settings") }}
                >
                  <Settings className="h-5 w-5" />
                  <span className="group-data-[collapsible=icon]:hidden">
                    {t("Settings")}
                  </span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="h-svh max-h-svh overflow-hidden">
        <header
          className="sticky top-0 z-30 flex shrink-0 min-h-[3.5rem] items-center gap-3 border-b bg-background/95 px-4 py-2 pt-[calc(env(safe-area-inset-top,0px)+0.5rem)] backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6 md:gap-4"
        >
          <SidebarTrigger />
          <div className="ml-auto flex items-center gap-2">
            <RefreshControls />
            <NotificationBell />
            <UserNav />
          </div>
        </header>
        {/* refreshGeneration remounts the page so client data loaders re-run after manual refresh.
            Offline refreshes do NOT bump generation (see refresh-context) so the UI stays put.
            Scroll lives here so the header above stays fixed while the page content moves. */}
        <main className="page-shell min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-y-contain" key={refreshGeneration}>
          <OfflineContentBanner />
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
        <ErrorBoundary>
          <OfflineIndicator />
        </ErrorBoundary>
        <PushForegroundListener />
        {/* Shells in background; photos; content caches when each page is visited */}
        <OfflineShellPrecache />
        <OfflineCacheWarmup />
        <OfflineRouteCache />
        <PushOnboardingGuide />
        <OfflineSyncBootstrap />
        <DataSyncListener />
        <InstallPrompt />
      </SidebarInset>
    </>
  );
}
