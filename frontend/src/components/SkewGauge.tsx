"use client";

import { motion } from "framer-motion";

interface SkewGaugeProps {
  /** Skew value (call IV - put IV). Negative = fear, positive = greed. */
  skew: number;
  /** Label text (e.g. the expiry) */
  label?: string;
}

/**
 * SVG arc-gauge showing the skew on a Fear ←→ Greed spectrum.
 *
 * Range: clamped to [-40, +40] for display.
 * Centre (0) is neutral.
 * Left/negative  → Fear  (red/orange)
 * Right/positive → Greed (green/teal)
 */
export default function SkewGauge({ skew, label }: SkewGaugeProps) {
  const CLAMP = 40;
  const clamped = Math.max(-CLAMP, Math.min(CLAMP, skew));
  // Map [-40, 40] → [0, 1]
  const normalized = (clamped + CLAMP) / (2 * CLAMP);

  // Arc geometry — a half-circle from 180° (left) to 0° (right)
  const cx = 150;
  const cy = 140;
  const r = 110;
  const startAngle = Math.PI; // 180°
  const endAngle = 0; // 0°
  const needleAngle = startAngle - normalized * Math.PI; // left=π, right=0

  // Arc path for the coloured track
  const arcPath = describeArc(cx, cy, r, startAngle, endAngle);

  // Needle end-point
  const needleLen = 90;
  const nx = cx + needleLen * Math.cos(needleAngle);
  const ny = cy - needleLen * Math.sin(needleAngle);

  // Colour: interpolate red→neutral→teal based on normalized
  const color = skewColor(normalized);

  // Sentiment label
  const sentimentLabel =
    skew < -15
      ? "Extreme Fear"
      : skew < -5
        ? "Fear"
        : skew > 15
          ? "Extreme Greed"
          : skew > 5
            ? "Greed"
            : "Neutral";

  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        viewBox="0 0 300 160"
        className="w-full max-w-[340px]"
        aria-label={`Skew gauge: ${skew.toFixed(1)}%`}
      >
        {/* Background arc */}
        <path
          d={arcPath}
          fill="none"
          stroke="#1f1f1f"
          strokeWidth={18}
          strokeLinecap="round"
        />

        {/* Gradient arc overlay — draw to needle position */}
        <defs>
          <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="30%" stopColor="#f97316" />
            <stop offset="50%" stopColor="#737373" />
            <stop offset="70%" stopColor="#14b8a6" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>
        <path
          d={arcPath}
          fill="none"
          stroke="url(#gaugeGrad)"
          strokeWidth={18}
          strokeLinecap="round"
          opacity={0.35}
        />

        {/* Tick marks */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const a = startAngle - t * Math.PI;
          const inner = r - 14;
          const outer = r + 14;
          return (
            <line
              key={t}
              x1={cx + inner * Math.cos(a)}
              y1={cy - inner * Math.sin(a)}
              x2={cx + outer * Math.cos(a)}
              y2={cy - outer * Math.sin(a)}
              stroke="#404040"
              strokeWidth={1.5}
            />
          );
        })}

        {/* Labels */}
        <text x={20} y={155} fill="#ef4444" fontSize={11} fontFamily="var(--font-geist-mono)">
          FEAR
        </text>
        <text
          x={280}
          y={155}
          fill="#14b8a6"
          fontSize={11}
          fontFamily="var(--font-geist-mono)"
          textAnchor="end"
        >
          GREED
        </text>

        {/* Needle */}
        <motion.line
          x1={cx}
          y1={cy}
          x2={nx}
          y2={ny}
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          initial={{ x2: cx - needleLen, y2: cy }}
          animate={{ x2: nx, y2: ny }}
          transition={{ type: "spring", stiffness: 60, damping: 15 }}
        />
        {/* Needle hub */}
        <circle cx={cx} cy={cy} r={6} fill={color} />
        <circle cx={cx} cy={cy} r={3} fill="#0a0a0a" />
      </svg>

      {/* Digital readout */}
      <div className="text-center -mt-2">
        <span
          className="font-mono text-3xl font-bold tracking-tight"
          style={{ color }}
        >
          {skew > 0 ? "+" : ""}
          {skew.toFixed(1)}%
        </span>
        <p className="text-xs text-muted-foreground mt-1 uppercase tracking-widest">
          {sentimentLabel}
        </p>
        {label && (
          <p className="text-xs text-muted-foreground/60 mt-0.5">{label}</p>
        )}
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
) {
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy - r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy - r * Math.sin(endAngle);
  return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
}

function skewColor(normalized: number): string {
  if (normalized < 0.3) return "#ef4444"; // red
  if (normalized < 0.45) return "#f97316"; // orange
  if (normalized > 0.7) return "#10b981"; // green
  if (normalized > 0.55) return "#14b8a6"; // teal
  return "#737373"; // neutral grey
}
