"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { UpstreamProviderUsage } from "@/lib/upstream-usage/types";

export function useUpstreamUsage(providerId?: string | null) {
  const [usages, setUsages] = useState<UpstreamProviderUsage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const fetchUsage = useCallback(
    async (force = false) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (providerId) params.set("provider", providerId);
        if (force) params.set("refresh", "1");

        const res = await fetch(`/api/usage/upstream?${params.toString()}`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const json = (await res.json()) as { data: UpstreamProviderUsage[] };
        setUsages(json.data ?? []);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      } finally {
        setLoading(false);
        inFlightRef.current = false;
      }
    },
    [providerId]
  );

  useEffect(() => {
    fetchUsage(false);
    // Refresh automatically every 120 seconds
    const timer = setInterval(() => {
      fetchUsage(false);
    }, 120 * 1000);
    return () => clearInterval(timer);
  }, [fetchUsage]);

  const refresh = useCallback(() => {
    return fetchUsage(true);
  }, [fetchUsage]);

  const currentUsage = providerId
    ? usages.find(
        (u) =>
          u.provider === providerId ||
          (providerId === "openai" && u.provider === "openai-codex")
      ) ?? usages[0] ?? null
    : usages.length === 1
    ? usages[0]
    : null;

  return {
    usages,
    currentUsage,
    loading,
    error,
    refresh,
  };
}
