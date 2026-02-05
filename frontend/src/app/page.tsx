"use client";

import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import SkewGauge from "@/components/SkewGauge";
import DvolBadge from "@/components/DvolBadge";
import EngineRoomTable from "@/components/EngineRoomTable";
import { useSentiment } from "@/hooks/useSentiment";

export default function Dashboard() {
  const { sentiment, loading, fetchError } = useSentiment();

  const data = sentiment?.data ?? null;
  const lastUpdated = sentiment?.last_updated;
  const backendError = sentiment?.error;

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-full border-2 border-zinc-700 border-t-teal-400 animate-spin" />
          <p className="text-sm text-muted-foreground font-mono">
            Initializing Volatility Engine...
          </p>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Error state
  // -----------------------------------------------------------------------
  if (fetchError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full bg-card border-red-500/20">
          <CardHeader>
            <CardTitle className="text-red-400 text-lg">
              Connection Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground font-mono">
              {fetchError}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-3">
              Ensure the backend is running on{" "}
              <code className="text-zinc-400">localhost:8000</code>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Data-pending state (backend started but hasn't fetched yet)
  // -----------------------------------------------------------------------
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-full border-2 border-zinc-700 border-t-orange-400 animate-spin" />
          <p className="text-sm text-muted-foreground font-mono">
            {backendError
              ? `Backend error: ${backendError}`
              : "Waiting for first data refresh..."}
          </p>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Nearest-expiry skew for the hero gauge
  // -----------------------------------------------------------------------
  const nearestSkew = data.nearest_skew ?? 0;
  const nearestExpiry = data.nearest_expiry ?? "—";

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b border-border/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-teal-400 animate-pulse" />
            <h1 className="text-sm font-mono font-semibold tracking-wide uppercase text-foreground/80">
              Volatility Sentiment Engine
            </h1>
          </div>
          <div className="flex items-center gap-4">
            {data.btc_price && (
              <span className="font-mono text-sm text-muted-foreground">
                BTC{" "}
                <span className="text-foreground">
                  ${data.btc_price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </span>
            )}
            {lastUpdated && (
              <span className="text-xs text-muted-foreground/60 font-mono">
                Updated{" "}
                {new Date(lastUpdated).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* ============================================================= */}
        {/* HERO SECTION — Gauge + DVOL Badge                             */}
        {/* ============================================================= */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Card className="bg-card/60 backdrop-blur border-border/30">
            <CardHeader className="pb-2 text-center">
              <CardTitle className="text-xs uppercase tracking-[0.25em] text-muted-foreground font-medium">
                Volatility Temperature — Nearest Expiry
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col md:flex-row items-center justify-center gap-8 md:gap-16 py-4">
                {/* Gauge */}
                <SkewGauge
                  skew={nearestSkew}
                  label={`Nearest: ${nearestExpiry}`}
                />

                {/* DVOL + meta */}
                <div className="flex flex-col items-center gap-6">
                  {data.dvol !== null && data.dvol_label && (
                    <DvolBadge dvol={data.dvol} label={data.dvol_label} />
                  )}

                  {/* Quick stats */}
                  <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-center">
                    <Stat
                      label="Nearest Expiry"
                      value={nearestExpiry}
                    />
                    <Stat
                      label="Expiries Tracked"
                      value={String(data.skews.length)}
                    />
                    <Stat
                      label="Skew Range"
                      value={skewRange(data.skews)}
                    />
                    <Stat
                      label="DVOL"
                      value={data.dvol ? `${data.dvol.toFixed(1)}` : "—"}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.section>

        {/* ============================================================= */}
        {/* ENGINE ROOM — Transparency Table                              */}
        {/* ============================================================= */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
        >
          <Card className="bg-card/60 backdrop-blur border-border/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs uppercase tracking-[0.25em] text-muted-foreground font-medium flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-500/80" />
                Engine Room — 25-Delta Risk Reversal by Expiry
              </CardTitle>
            </CardHeader>
            <CardContent>
              <EngineRoomTable skews={data.skews} />
            </CardContent>
          </Card>
        </motion.section>

        {/* ============================================================= */}
        {/* Footer note                                                   */}
        {/* ============================================================= */}
        <footer className="text-center pb-8">
          <p className="text-[10px] text-muted-foreground/40 font-mono">
            Data sourced from Deribit public API. Skew = Call IV (25{"\u0394"}) -
            Put IV (25{"\u0394"}). Positive = Greed, Negative = Fear. Refreshed
            every 60 s.
          </p>
        </footer>
      </main>
    </div>
  );
}

/* ---------- small stat component ---------- */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60">
        {label}
      </p>
      <p className="font-mono text-sm text-foreground/90">{value}</p>
    </div>
  );
}

/* ---------- helpers ---------- */

function skewRange(
  skews: { skew: number | null }[],
): string {
  const vals = skews
    .map((s) => s.skew)
    .filter((v): v is number => v !== null);
  if (!vals.length) return "—";
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return `${min > 0 ? "+" : ""}${min.toFixed(1)} / ${max > 0 ? "+" : ""}${max.toFixed(1)}`;
}
