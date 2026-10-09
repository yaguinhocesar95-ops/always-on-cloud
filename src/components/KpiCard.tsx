import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

export type KpiTone = "default" | "success" | "destructive" | "warning" | "info" | "gold";

const TONE: Record<KpiTone, string> = {
  default: "text-foreground",
  success: "text-success",
  destructive: "text-destructive",
  warning: "text-warning",
  info: "text-info",
  gold: "text-gold",
};

/** Cartão de estatística: rótulo pequeno, valor grande em mono, variação e mini-gráfico opcional. */
export function KpiCard({
  label,
  value,
  tone = "default",
  delta,
  hint,
  series,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: KpiTone;
  /** Variação: positivo = sobe, negativo = desce. */
  delta?: { value: number; text: string } | null;
  hint?: ReactNode;
  series?: number[];
  className?: string;
}) {
  const dir = delta == null ? null : delta.value > 0 ? "up" : delta.value < 0 ? "down" : "flat";
  return (
    <div className={cn("ypx-card flex flex-col gap-1 p-4", className)}>
      <span className="ypx-label">{label}</span>
      <span className={cn("ypx-num text-kpi leading-tight font-semibold transition-colors", TONE[tone])}>{value}</span>
      {delta && (
        <span
          className={cn(
            "ypx-num inline-flex items-center gap-1 text-caption",
            dir === "up" && "text-success",
            dir === "down" && "text-destructive",
            dir === "flat" && "text-muted-foreground",
          )}
        >
          {dir === "up" ? (
            <ArrowUpRight className="size-3.5" strokeWidth={1.75} aria-label="subiu" />
          ) : dir === "down" ? (
            <ArrowDownRight className="size-3.5" strokeWidth={1.75} aria-label="caiu" />
          ) : (
            <Minus className="size-3.5" strokeWidth={1.75} aria-label="estável" />
          )}
          {delta.text}
        </span>
      )}
      {series && series.length > 1 && (
        <div className="mt-1 h-8" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series.map((v, i) => ({ i, v }))}>
              <Line dataKey="v" stroke="var(--gold)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {hint && <span className="text-caption text-muted-foreground">{hint}</span>}
    </div>
  );
}
