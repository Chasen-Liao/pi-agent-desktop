"use client";

import { useEffect, useState } from "react";
import { defaultSidebarPreferences, parseSidebarPreferences } from "./projects";

const STORAGE_KEY = "pi-sidebar-projects-v1";

export function useSidebarPreferences() {
  const [preferences, setPreferences] = useState(defaultSidebarPreferences);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      setPreferences(parseSidebarPreferences(localStorage.getItem(STORAGE_KEY)));
    } catch {
      // Storage may be unavailable; navigation still works for this visit.
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      // Presentation preferences must never block a session action.
    }
  }, [preferences, loaded]);

  return [preferences, setPreferences] as const;
}
