"use client";

import { motion } from "framer-motion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ExpirySkew } from "@/hooks/useSentiment";

interface EngineRoomTableProps {
  skews: ExpirySkew[];
}

/**
 * Transparency table — shows exactly which 25-delta options
 * were selected for each expiry.
 */
export default function EngineRoomTable({ skews }: EngineRoomTableProps) {
  if (!skews.length) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No expiry data available.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border/50">
      <Table>
        <TableHeader>
          <TableRow className="border-border/40 hover:bg-transparent">
            <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Expiry
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              DTE
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Benchmark Call
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
              Benchmark Put
            </TableHead>
            <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium text-right">
              Skew
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {skews.map((row, i) => (
            <motion.tr
              key={row.expiry}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="border-border/30 hover:bg-white/[0.02]"
            >
              <TableCell className="font-mono text-sm text-foreground/90 whitespace-nowrap">
                {row.expiry}
              </TableCell>
              <TableCell className="font-mono text-sm text-muted-foreground">
                {row.days_to_expiry}d
              </TableCell>
              <TableCell className="font-mono text-xs text-foreground/70 whitespace-nowrap">
                {row.benchmark_call ? (
                  <>
                    ${formatStrike(row.benchmark_call.strike)} Strike{" "}
                    <span className="text-teal-400/80">
                      ({"\u0394"} {row.benchmark_call.delta.toFixed(2)})
                    </span>
                    <span className="text-muted-foreground ml-1.5">
                      IV {row.benchmark_call.mark_iv.toFixed(1)}%
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground/50">—</span>
                )}
              </TableCell>
              <TableCell className="font-mono text-xs text-foreground/70 whitespace-nowrap">
                {row.benchmark_put ? (
                  <>
                    ${formatStrike(row.benchmark_put.strike)} Strike{" "}
                    <span className="text-red-400/80">
                      ({"\u0394"} {row.benchmark_put.delta.toFixed(2)})
                    </span>
                    <span className="text-muted-foreground ml-1.5">
                      IV {row.benchmark_put.mark_iv.toFixed(1)}%
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground/50">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {row.skew !== null ? (
                  <span
                    className={`font-mono text-sm font-semibold ${
                      row.skew > 0
                        ? "text-teal-400"
                        : row.skew < 0
                          ? "text-red-400"
                          : "text-zinc-500"
                    }`}
                  >
                    {row.skew > 0 ? "+" : ""}
                    {row.skew.toFixed(2)}%
                  </span>
                ) : (
                  <span className="text-muted-foreground/50">—</span>
                )}
              </TableCell>
            </motion.tr>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ---------- helpers ---------- */

function formatStrike(strike: number): string {
  if (strike >= 1000) {
    return `${(strike / 1000).toFixed(strike % 1000 === 0 ? 0 : 1)}k`;
  }
  return strike.toFixed(0);
}
