"use client";

import { useCallback, useEffect, useState } from "react";
import { UserProfile, createUser, fetchUser } from "./api";

const STORAGE_KEY = "cda_user_id";

/** Returns the anonymous user profile, creating one on first visit. */
export function useUser() {
  const [user, setUser] = useState<UserProfile | null>(null);

  const refresh = useCallback(async () => {
    const id = localStorage.getItem(STORAGE_KEY);
    if (!id) return;
    try {
      setUser(await fetchUser(id));
    } catch {
      // Stale ID (e.g. server store was reset) — re-register.
      localStorage.removeItem(STORAGE_KEY);
      await ensureUser(setUser);
    }
  }, []);

  useEffect(() => {
    const id = localStorage.getItem(STORAGE_KEY);
    if (id) {
      refresh();
    } else {
      ensureUser(setUser);
    }
    window.addEventListener(POINTS_EVENT, refresh);
    return () => window.removeEventListener(POINTS_EVENT, refresh);
  }, [refresh]);

  return { user, setUser, refresh };
}

const POINTS_EVENT = "cda-points-changed";

/** Tell every useUser() instance (e.g. the header badge) to refetch. */
export function notifyPointsChanged() {
  window.dispatchEvent(new Event(POINTS_EVENT));
}

async function ensureUser(set: (u: UserProfile) => void) {
  try {
    const user = await createUser();
    localStorage.setItem(STORAGE_KEY, user.id);
    set(user);
  } catch {
    // Backend offline — points UI simply stays hidden.
  }
}
