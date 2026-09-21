"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { UpstreamProviderUsage } from "@/lib/upstream-usage/types";

export function useUpstreamUsage(providerId?: string | null) {
  const [usages, setUsages] = useState<UpstreamProviderUsage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<{ id: number; controller: AbortController } | null>(null);

  const fetchUsage = useCallback(
    async (force = false) => {
      requestRef.current?.controller.abort();
      const request = {
        id: (requestRef.current?.id ?? 0) + 1,
        controller: new AbortController(),
      };
      requestRef.current = request;
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (providerId) params.set("provider", providerId);
        if (force) params.set("refresh", "1");

        const res = await fetch(`/api/usage/upstream?${params.toString()}`, {
          signal: request.controller.signal,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const json = (await res.json()) as { data: UpstreamProviderUsage[] };
        if (requestRef.current?.id === request.id) setUsages(json.data ?? []);
      } catch (err: unknown) {
        if (request.controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (requestRef.current?.id === request.id) setError(msg);
      } finally {
        if (requestRef.current?.id === request.id) {
          requestRef.current = null;
          setLoading(false);
        }
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
    return () => {
      clearInterval(timer);
      requestRef.current?.controller.abort();
    };
  }, [fetchUsage]);

  const refresh = useCallback(() => {
    return fetchUsage(true);
  }, [fetchUsage]);

  const currentUsage = providerId
    ? usages.find(
        (u) =>
          u.provider === providerId ||
          (providerId === "openai" && u.provider === "openai-codex")
      ) ?? null
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
