"use client";

import { useAuth } from "@/contexts/auth-context";

export function useScope() {
  const { barrio, organizacion, barrioOrg } = useAuth();
  return { barrio, organizacion, barrioOrg };
}
