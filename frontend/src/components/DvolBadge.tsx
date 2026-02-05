"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface DvolBadgeProps {
  dvol: number;
  label: string;
}

/**
 * DVOL badge with conditional styling:
 *  - DVOL < 45  → Blue, "Market Asleep"
 *  - DVOL > 70  → Pulsing Orange, "Market Explosive"
 *  - Otherwise  → Grey, "Normal Volatility"
 */
export default function DvolBadge({ dvol, label }: DvolBadgeProps) {
  const isAsleep = dvol < 45;
  const isExplosive = dvol > 70;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        DVOL (Volatility Index)
      </span>
      <Badge
        variant="outline"
        className={cn(
          "px-4 py-1.5 text-sm font-mono font-semibold rounded-full border",
          isAsleep &&
            "border-blue-500/40 bg-blue-500/10 text-blue-400",
          isExplosive &&
            "border-orange-500/40 bg-orange-500/10 text-orange-400 animate-pulse-glow",
          !isAsleep &&
            !isExplosive &&
            "border-zinc-600/40 bg-zinc-800/40 text-zinc-400",
        )}
      >
        {dvol.toFixed(1)} — {label}
      </Badge>
    </div>
  );
}
