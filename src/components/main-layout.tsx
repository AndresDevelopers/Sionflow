
"use client";

import { type ReactNode, useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Settings } from "lucide-react";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LanguageSwitcher } from "@/components/language-switcher";
import Image from "next/image";
import { useI18n } from "@/contexts/i18n-context";
import { useAuth } from "@/contexts/auth-context";
import { auth } from "@/lib/firebase";
import OfflineIndicator from "@/components/offline-indicator";
import { PushForegroundListener } from "@/components/push-foreground-listener";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { ErrorBoundary } from "@/components/error-boundary";
import { signOut } from "firebase/auth";
import { useToast } from "@/hooks/use-toast";
import { NotificationBell } from "./notification-bell";
import { ChangelogDialog } from "./changelog-dialog";
import { InstallPrompt } from "@/components/install-prompt";
import { navigationItems } from "@/lib/navigation";
import { usersCollection } from "@/lib/collections";
import { doc, getDoc } from "firebase/firestore";
import { Shield } from "lucide-react";
import { isAdmin, normalizeRole } from "@/lib/roles";

function Logo() {
  const { mainPage } = useAuth();
  
  return (
    <Link
      href={mainPage}
      className="flex items-center gap-2 font-semibold text-foreground"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-6 w-6 text-primary"
      >
        <path d="M12 22a10 10 0 1 0-10-10" />
        <path d="M12 18a6 6 0 1 0 0-12" />
        <path d="M12 14a2 2 0 1 0 0-4" />
        <path d="M22 12a10 10 0 0 0-10-10" />
        <path d="M12 12a6 6 0 0 1 6-6" />
        <path d="M12 12a2 2 0 0 1 2-2" />
      </svg>
      <span className="hidden group-data-[state=expanded]:inline">
        QuorumFlow
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
      await signOut(auth);
      toast({
        title: "Sesión cerrada",
        description: "Has cerrado sesión exitosamente.",
      });
      router.push("/login");
    } catch (error) {
      console.error("Logout error", error);
      toast({
        title: "Error",
        description: "No se pudo cerrar la sesión.",
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
              <Image
                src={user.photoURL}
                alt={user.displayName ?? "User Avatar"}
                fill
                sizes="32px"
                className="rounded-full"
                data-ai-hint="profile picture"
                priority
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
        <DropdownMenuItem onClick={handleLogout}>
          <LogOut className="mr-2 h-4 w-4" />
          <span>{t("Log out")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MainLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const { setOpenMobile } = useSidebar();
  const { user, userRole } = useAuth();
  const [version, setVersion] = useState("");
  const [visibleNavItems, setVisibleNavItems] = useState(navigationItems);
  const showAdminLink = isAdmin(userRole);

  useEffect(() => {
    fetch("/changelog.json")
      .then((res) => res.json())
      .then((data) => {
        setVersion(data.current);
      })
      .catch((error) => console.error("Error fetching version:", error));
  }, []);

  useEffect(() => {
    let isMounted = true;

    const fetchVisibility = async () => {
      if (!user) {
        if (isMounted) {
          setVisibleNavItems(navigationItems);
        }
        return;
      }

      try {
        const userDocRef = doc(usersCollection, user.uid);
        const snapshot = await getDoc(userDocRef);

        if (!isMounted) return;

        if (!snapshot.exists()) {
          setVisibleNavItems(navigationItems);
          return;
        }

        const data = snapshot.data() as {
          visiblePages?: string[];
        };
        const allowed = data.visiblePages;

        if (Array.isArray(allowed) && allowed.length > 0) {
          const effectiveAllowed = Array.from(new Set([...allowed, "/church-chat"]));
          setVisibleNavItems(
            navigationItems.filter((item) => effectiveAllowed.includes(item.href))
          );
        } else {
          setVisibleNavItems(navigationItems);
        }
      } catch (error) {
        console.error("Error fetching user visibility", error);
        if (isMounted) {
          setVisibleNavItems(navigationItems);
        }
      }
    };

    fetchVisibility();

    return () => {
      isMounted = false;
    };
  }, [user, userRole]);

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
                    tooltip={{ children: item.label }}
                  >
                    <item.icon className="h-5 w-5" />
                    <span className="group-data-[collapsible=icon]:hidden">
                      {item.label}
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
                    tooltip={{ children: "Administración" }}
                  >
                    <Shield className="h-5 w-5" />
                    <span className="group-data-[collapsible=icon]:hidden">
                      Administración
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
      <SidebarInset>
        <header
          className="sticky top-0 z-10 flex min-h-[3.5rem] items-center gap-3 border-b bg-background/95 px-4 py-2 pt-[calc(env(safe-area-inset-top,0px)+0.5rem)] backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6 md:gap-4"
        >
          <SidebarTrigger />
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
            <UserNav />
          </div>
        </header>
        <main className="page-shell">{children}</main>
        <ErrorBoundary>
          <OfflineIndicator />
        </ErrorBoundary>
        <PushForegroundListener />
        <ServiceWorkerRegistration />
        <InstallPrompt />
      </SidebarInset>
    </>
  );
}
