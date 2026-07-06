"use client";

import { useAuth } from "@/contexts/auth-context";
import { canWrite, type UserPermission } from "@/lib/roles";

interface UsePermissionReturn {
  canWrite: boolean;
  permission: UserPermission | null;
  loading: boolean;
}

export function usePermission(): UsePermissionReturn {
  const { userPermission, loading } = useAuth();
  return {
    canWrite: canWrite(userPermission),
    permission: userPermission,
    loading,
  };
}
