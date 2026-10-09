import { Check, CircleSlash, X } from "lucide-react";

import { CostParamsPanel } from "@/components/CostParamsPanel";
import { useCostParams } from "@/hooks/useCostParams";
import type { EngineMode, ScalpEngine } from "@/lib/scalp";
import { cn } from "@/lib/utils";

type Props = {
  engine: ScalpEngine;
  mode: EngineMode;
  onModeChange: (mode: EngineMode) => void;
  /** Par atual: usado para sugerir os custos pelo volume 24h. */
  symbol?: string | null;
};

const STATUS_LABEL = {
  pass: "ok",
  block: "bloqueia",
  unavailable: "não disponível",
} as const;

export function FilterPanel({ engine, mode, onModeChange, symbol = null }: Props) {
  const { filters, metrics } = engine;
  const cost = useCostParams();
  const blocked = filters.filter((f) => f.status !== "pass").length;

  return (
    <section className="tv-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="tv-headline text-[0.95rem] text-foreground">Filtros e confiança do preço-alvo</h2>
        <div className="flex items-center gap-1 rounded-full border border-border bg-muted/30 p-1">
          {(["baseline", "stable-cluster"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              className={cn(
                "rounded-full px-3 py-1 font-mono text-[0.6rem] tracking-[0.14em] uppercase transition-colors",
                mode === m
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "baseline" ? "modo padrão" : "agrupamento estável"}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-2 font-sans text-[0.7rem] text-muted-foreground">
        No modo padrão, os filtros são apenas informativos. No agrupamento estável, qualquer item
        abaixo marcado como bloqueia ou não disponível derruba o sinal — nenhum filtro cria entrada.
        Modo padrão agora:{" "}
        <span className={engine.readyBaseline ? "text-success" : "text-warning"}>
          {engine.readyBaseline ? "liberaria o sinal" : "já bloqueado"}
        </span>
        .
      </p>

      {metrics != null && (
        <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-2">
          <Cell label="concentração" value={`${(metrics.concentration * 100).toFixed(0)}%`} />
          <Cell
            label="vantagem 1ª vs 2ª"
            value={`${(metrics.gapToSecond * 100).toFixed(0)} p.p.`}
          />
          <Cell
            label="maior permanência"
            value={`${metrics.longestStreak}s · ${metrics.visits} visitas`}
          />
          <Cell
            label="variação do preço-alvo"
            value={
              metrics.stabilityDriftPct == null
                ? "—"
                : `${metrics.stabilityDriftPct.toFixed(3).replace(".", ",")}%`
            }
          />
        </div>
      )}

      <CostParamsPanel
        symbol={symbol}
        params={cost.params}
        sources={cost.sources}
        onFieldChange={cost.setField}
        onSuggestion={cost.applySuggestion}
      />

      <ul className="mt-4 space-y-1.5">
        {filters.map((f) => (
          <li
            key={f.id}
            className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2"
          >
            <span
              className={cn(
                "mt-0.5 shrink-0",
                f.status === "pass"
                  ? "text-success"
                  : f.status === "block"
                    ? "text-destructive"
                    : "text-warning",
              )}
            >
              {f.status === "pass" ? (
                <Check className="size-3.5" />
              ) : f.status === "block" ? (
                <X className="size-3.5" />
              ) : (
                <CircleSlash className="size-3.5" />
              )}
            </span>
            <div className="min-w-0">
              <div className="font-mono text-[0.7rem] tracking-[0.08em] text-foreground uppercase">
                {f.label} <span className="text-muted-foreground">· {STATUS_LABEL[f.status]}</span>
              </div>
              <div className="font-mono text-[0.68rem] break-words text-muted-foreground">
                {f.detail}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-3 font-mono text-[0.65rem] text-muted-foreground">
        {blocked === 0
          ? "Nenhum filtro em bloqueio neste instante."
          : `${blocked} item(ns) em bloqueio ou sem medição disponível.`}{" "}
        Versão do motor: {engine.engineVersion}.
      </p>
    </section>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="tv-plate min-w-0 break-words px-3 py-2.5">
      <div className="text-[0.65rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm tabular-nums text-foreground">{value}</div>
    </div>
  );
}
