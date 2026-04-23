"use client";

import { useEffect, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types (mirror the backend Pydantic models)
// ---------------------------------------------------------------------------

export interface BenchmarkOption {
  instrument: string;
  strike: number;
  delta: number;
  mark_iv: number;
}

export interface ExpirySkew {
  expiry: string;
  expiry_timestamp: number;
  days_to_expiry: number;
  benchmark_call: BenchmarkOption | null;
  benchmark_put: BenchmarkOption | null;
  skew: number | null;
}

export interface SentimentData {
  dvol: number | null;
  dvol_label: string | null;
  nearest_skew: number | null;
  nearest_expiry: string | null;
  skews: ExpirySkew[];
  btc_price: number | null;
}

export interface SentimentResponse {
  data: SentimentData | null;
  last_updated: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:8000");

if (process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_API_URL) {
  console.warn(
    "NEXT_PUBLIC_API_URL is not set — API requests will fail in production.",
  );
}
const POLL_INTERVAL = 30_000; // 30 seconds

export function useSentiment() {
  const [sentiment, setSentiment] = useState<SentimentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchSentiment = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/sentiment`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: SentimentResponse = await res.json();
      setSentiment(json);
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSentiment();
    const id = setInterval(fetchSentiment, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchSentiment]);

  return { sentiment, loading, fetchError };
}
