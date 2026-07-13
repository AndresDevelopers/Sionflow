import type { LucideIcon } from "lucide-react";
import type { Member } from "@/lib/types";
import {
  AlertTriangle,
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
  { href: "/", i18nKey: "Dashboard", icon: Home },
  { href: "/members", i18nKey: "Members", icon: UserCheck },
  {
    href: "/observations",
    i18nKey: "Observations",
    icon: AlertTriangle,
  },
  { href: "/converts", i18nKey: "Converts", icon: HeartHandshake },
  { href: "/ministering", i18nKey: "Ministering", icon: Users },
  { href: "/birthdays", i18nKey: "Birthdays", icon: Cake },
  { href: "/family-search", i18nKey: "FamilySearch", icon: Library },
  {
    href: "/missionary-work",
    i18nKey: "Missionary Work",
    icon: HandHeart,
  },
  { href: "/service", i18nKey: "Service", icon: Wrench },
  { href: "/church-chat", i18nKey: "Church Chat", icon: MessageSquare },
  { href: "/council", i18nKey: "Council", icon: Gavel },
  { href: "/reports", i18nKey: "Reports", icon: FileText },
  { href: "/reports/activities", i18nKey: "Activities", icon: ClipboardList },
];
