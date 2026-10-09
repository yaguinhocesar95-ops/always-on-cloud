import { cn } from "@/lib/utils";

/** Posição (0–1) de um preço na faixa stop → alvo, e se ficou fora dela. */
export function rulerPosition(v: number | null, stop: number, target: number) {
  const span = target - stop;
  if (v == null || !Number.isFinite(v) || !(span > 0)) return { pct: null as number | null, outside: null as "below" | "above" | null };
  const raw = (v - stop) / span;
  return {
    pct: Math.max(0, Math.min(1, raw)),
    outside: raw < 0 ? ("below" as const) : raw > 1 ? ("above" as const) : null,
  };
}

/** Caminho já percorrido do gatilho até o alvo (0–100%). */
export function pathToTarget(v: number | null, trigger: number, target: number): number | null {
  if (v == null || !(target > trigger)) return null;
  return Math.max(0, Math.min(100, ((v - trigger) / (target - trigger)) * 100));
}

/** Régua stop → gatilho → preço atual → alvo. */
export function BetRuler({
  stop,
  trigger,
  target,
  current,
  fmt,
  showMarker = true,
  compact = false,
}: {
  stop: number;
  trigger: number;
  target: number;
  current: number | null;
  fmt: (v: number | null) => string;
  showMarker?: boolean;
  compact?: boolean;
}) {
  const trig = rulerPosition(trigger, stop, target).pct ?? 0.5;
  const cur = rulerPosition(current, stop, target);
  const toTarget = pathToTarget(current, trigger, target);
  return (
    <div data-testid="bet-ruler" data-pos={cur.pct == null ? "" : cur.pct.toFixed(3)} data-outside={cur.outside ?? ""}>
      <div className={cn("relative w-full rounded-full bg-surface-3", compact ? "h-1.5" : "h-2.5")}>
        <div className="absolute inset-y-0 left-0 rounded-l-full bg-destructive/25" style={{ width: `${trig * 100}%` }} />
        <div className="absolute inset-y-0 right-0 rounded-r-full bg-success/25" style={{ width: `${(1 - trig) * 100}%` }} />
        <div className="absolute -inset-y-1 w-0.5 bg-foreground/70" style={{ left: `${trig * 100}%` }} aria-hidden />
        {showMarker && cur.pct != null && (
          <div
            data-testid="bet-ruler-marker"
            className={cn(
              "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background transition-[left] duration-250 ease-out",
              compact ? "size-3" : "size-4",
              cur.pct >= trig ? "bg-success" : "bg-destructive",
            )}
            style={{ left: `${cur.pct * 100}%` }}
          />
        )}
      </div>
      {!compact && (
        <div className="mt-1.5 grid grid-cols-3 gap-2 text-caption">
          <span className="ypx-num text-destructive">▼ stop {fmt(stop)}</span>
          <span className="ypx-num text-center text-muted-foreground">gatilho {fmt(trigger)}</span>
          <span className="ypx-num text-right text-success">alvo {fmt(target)} ▲</span>
        </div>
      )}
      {showMarker && toTarget != null && !compact && (
        <p className="mt-1 text-caption text-muted-foreground">
          Caminho até o alvo: <span className="ypx-num font-semibold text-gold">{toTarget.toFixed(0)}%</span>
          {cur.outside === "below" && <span className="text-destructive"> · abaixo do stop</span>}
          {cur.outside === "above" && <span className="text-success"> · acima do alvo</span>}
        </p>
      )}
    </div>
  );
}
