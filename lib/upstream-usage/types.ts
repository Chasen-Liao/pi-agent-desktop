export interface UpstreamWindowUsage {
  id?: "5h" | "7d" | "daily_free" | string;
  label: string; // fallback label e.g. "5h" / "7d" / "Daily Free Requests"
  usedPercent: number; // 0..100
  resetAfterSeconds?: number;
  resetAt?: number;
}

export interface UpstreamBalance {
  currency: string;
  total: string;
  granted?: string;
  toppedUp?: string;
}

export interface UpstreamProviderUsage {
  provider: string;
  providerName: string;
  planType?: string;
  windows?: UpstreamWindowUsage[];
  balance?: UpstreamBalance[];
  rawLimit?: {
    used?: number;
    limit?: number | null;
    remaining?: number | null;
  };
  error?: string;
  updatedAt: number;
}
