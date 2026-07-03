
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { firestore } from "@/lib/firebase";
import logger from "@/lib/logger";
import { getCookie, setCookieWithMinutes, deleteCookie } from "@/lib/cookie-utils";
import { doc, getDoc, setDoc } from "firebase/firestore";

const VERSION_ENDPOINT = "/version.json";
const DISMISS_COOKIE = "update_dismissed";
const DISMISS_DURATION_MINUTES = 30;

interface VersionManifest {
  version?: string;
  [key: string]: unknown;
}

async function resolveVersion(fetchClient: typeof fetch): Promise<string | null> {
  try {
    const response = await fetchClient(VERSION_ENDPOINT);
    const data: VersionManifest = await response.json();
    if (typeof data.version === "string" && data.version.trim().length > 0) {
      return data.version;
    }
    logger.warn({ data, message: "Version manifest missing version field" });
    return null;
  } catch (error) {
    logger.error({ error, message: "Unable to resolve application version" });
    return null;
  }
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  handleDismiss: () => Promise<void>;
  handleUpdate: () => void;
}

export function useUpdateCheck(): UpdateCheckResult {
  const { user } = useAuth();
  const [hasUpdate, setHasUpdate] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  const fetchClient = useMemo(() => fetch, []);

  // Resolve current version on mount
  useEffect(() => {
    let isMounted = true;

    resolveVersion(fetchClient).then((version) => {
      if (isMounted) {
        setCurrentVersion(version);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [fetchClient]);

  // Check for updates
  useEffect(() => {
    if (checked || !user || !currentVersion) {
      return;
    }

    if (getCookie(DISMISS_COOKIE) === "true") {
      return;
    }

    let isActive = true;

    const checkForUpdates = async () => {
      try {
        const latest = await resolveVersion(fetchClient);
        if (!isActive || !latest || latest === currentVersion) {
          return;
        }

        const userDocRef = doc(firestore, "userPreferences", user.uid);
        const userDoc = await getDoc(userDocRef);

        if (!isActive) return;

        if (userDoc.exists()) {
          const { dismissedVersion } = userDoc.data() as { dismissedVersion?: string };
          if (dismissedVersion === latest) {
            return;
          }
        }

        setLatestVersion(latest);
        setHasUpdate(true);
        setChecked(true);
      } catch (error) {
        logger.warn({ error, message: "Error while checking for application updates" });
      }
    };

    checkForUpdates();

    return () => {
      isActive = false;
    };
  }, [checked, user, currentVersion, fetchClient]);

  const handleDismiss = useCallback(async () => {
    if (!user || !latestVersion) return;

    setHasUpdate(false);

    try {
      setCookieWithMinutes(DISMISS_COOKIE, "true", DISMISS_DURATION_MINUTES);
      const userDocRef = doc(firestore, "userPreferences", user.uid);
      await setDoc(
        userDocRef,
        {
          dismissedVersion: latestVersion,
          dismissedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (err) {
      logger.warn({ error: err, message: "Failed to persist dismissed version" });
    }
  }, [user, latestVersion]);

  const handleUpdate = useCallback(() => {
    if (!user || !latestVersion) return;

    const userDocRef = doc(firestore, "userPreferences", user.uid);

    deleteCookie(DISMISS_COOKIE);
    setDoc(
      userDocRef,
      {
        dismissedVersion: latestVersion,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    ).catch((err) => {
      logger.warn({ error: err, message: "Failed to record update acknowledgement" });
    });

    window.location.reload();
  }, [user, latestVersion]);

  return { hasUpdate, handleDismiss, handleUpdate };
}
