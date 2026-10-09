import { cn } from "@/lib/utils";

/** Pontuação 0–100 num círculo de progresso dourado. */
export function ScoreRing({ value, size = 72, className }: { value: number; size?: number; className?: string }) {
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div
      role="img"
      aria-label={`Pontuação ${Math.round(v)} de 100`}
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--gold)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          style={{ transition: "stroke-dashoffset 250ms ease" }}
        />
      </svg>
      <span className="ypx-num absolute text-lg font-bold text-foreground">{Math.round(v)}</span>
    </div>
  );
}
