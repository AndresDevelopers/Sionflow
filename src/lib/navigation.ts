import type { LucideIcon } from "lucide-react";
import type { Member } from "@/lib/types";
import {
  AlertTriangle,
  BookUser,
  Cake,
  ClipboardList,
  FileText,
  Gavel,
  HandHeart,
  HeartHandshake,
  Home,
  Library,
  MessageSquare,
  UserCheck,
  Users,
  Wrench,
} from "lucide-react";

export type NavigationItem = {
  href: string;
  i18nKey: string;
  label: string;
  icon: LucideIcon;
};

export const buildMemberEditUrl = (memberId: string, returnTo?: string) => {
  const params = new URLSearchParams();
  params.set('edit', memberId);
  if (returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')) {
    params.set('returnTo', returnTo);
  }
  return `/members?${params.toString()}`;
};

export const buildMemberLink = ({
  name,
  memberId,
  members,
  memberMap,
}: {
  name: string;
  memberId?: string | null;
  members: Member[];
  memberMap: Map<string, string>;
}) => {
  if (memberId) return `/members/${memberId}`;
  let searchName = name;
  if (name.startsWith('Familia ')) {
    const lastName = name.replace('Familia ', '');
    const matchedMembers = members.filter(m => m.lastName === lastName);
    if (matchedMembers.length === 1) {
      return `/members/${matchedMembers[0].id}`;
    }
    searchName = lastName;
  } else {
    const mappedId = memberMap.get(name);
    if (mappedId) return `/members/${mappedId}`;
  }
  return `/members?search=${encodeURIComponent(searchName)}`;
};

export const navigationItems: NavigationItem[] = [
  { href: "/", i18nKey: "Dashboard", label: "Inicio", icon: Home },
  { href: "/members", i18nKey: "Members", label: "Miembros", icon: UserCheck },
  {
    href: "/observations",
    i18nKey: "Observations",
    label: "Observaciones",
    icon: AlertTriangle,
  },
  { href: "/converts", i18nKey: "Converts", label: "Conversos", icon: HeartHandshake },
  {
    href: "/future-members",
    i18nKey: "Future Members",
    label: "Futuros Miembros",
    icon: BookUser,
  },
  { href: "/ministering", i18nKey: "Ministering", label: "Ministración", icon: Users },
  { href: "/birthdays", i18nKey: "Birthdays", label: "Cumpleaños", icon: Cake },
  { href: "/family-search", i18nKey: "FamilySearch", label: "FamilySearch", icon: Library },
  {
    href: "/missionary-work",
    i18nKey: "Missionary Work",
    label: "Obra Misional",
    icon: HandHeart,
  },
  { href: "/service", i18nKey: "Service", label: "Servicio", icon: Wrench },
  { href: "/church-chat", i18nKey: "Church Chat", label: "Chat Iglesia", icon: MessageSquare },
  { href: "/council", i18nKey: "Council", label: "Consejo", icon: Gavel },
  { href: "/reports", i18nKey: "Reports", label: "Reportes", icon: FileText },
  { href: "/reports/activities", i18nKey: "Activities", label: "Actividades", icon: ClipboardList },
];
