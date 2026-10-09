/**
 * Caixas de custo com sugestão automática.
 *
 * A sugestão vem de uma função de servidor que classifica o par por volume
 * 24h. Nada aqui altera os valores protegidos do motor: só custo.
 */

import { useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { suggestCostParams } from "@/lib/cost-suggestion.functions";
import {
  rangeLabel,
  TIER_LABEL,
  TIER_RANGES,
  type LiquidityTier,
} from "@/lib/cost-tiers";
import type { CostField, CostParams, CostSources } from "@/hooks/useCostParams";
import { cn } from "@/lib/utils";
import { playNotificationSound } from "@/lib/notification-sounds";

type Props = {
  symbol: string | null;
  params: CostParams;
  sources: CostSources;
  onFieldChange: (field: CostField, value: number | null) => void;
  onSuggestion: (values: Partial<Record<CostField, number>>) => void;
};

const FIELDS: { id: CostField; label: string; hint: string }[] = [
  { id: "fee_pct", label: "taxa por ponta", hint: "cobrada na entrada e na saída" },
  {
    id: "spread_pct",
    label: "diferença entre compra e venda",
    hint: "distância entre os melhores preços de compra e venda",
  },
  { id: "slippage_pct", label: "variação de execução", hint: "possível piora no preço executado" },
];

const NOTE = "valores sugeridos com base em padrões de mercado para scalp puro, ajuste conforme o par";

export function CostParamsPanel({ symbol, params, sources, onFieldChange, onSuggestion }: Props) {
  const [loading, setLoading] = useState<CostField | "all" | null>(null);
  // Faixa sempre vinculada à moeda para a qual foi calculada: ao trocar a
  // moeda em "Último preço", a faixa anterior some até nova sugestão.
  const [tierInfo, setTierInfo] = useState<{ symbol: string; tier: LiquidityTier } | null>(null);
  const tier = tierInfo != null && tierInfo.symbol === symbol ? tierInfo.tier : null;

  async function suggest(field: CostField | "all") {
    if (!symbol) {
      playNotificationSound("erro");
      toast.error("Escolha uma moeda antes de pedir sugestão.");
      return;
    }
    setLoading(field);
    try {
      // Sempre a moeda exibida neste instante em "Último preço".
      const res = await suggestCostParams({ data: { symbol } });
      setTierInfo({ symbol: res.symbol, tier: res.tier });
      const s = res.suggestion;
      onSuggestion(field === "all" ? s : { [field]: s[field] });
      playNotificationSound("sugestao");
      toast.success(
        `Sugestão aplicada — faixa ${res.tier} (${TIER_LABEL[res.tier]}), ${res.symbol}`,
        { description: NOTE },
      );
    } catch {
      playNotificationSound("erro");
      toast.error("Não foi possível calcular a sugestão agora.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="mt-5 rounded-md border border-border/60 bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-mono text-[0.68rem] tracking-[0.14em] text-foreground uppercase">
          Custos de execução{" "}
          {tier && (
            <span className="text-muted-foreground">
              · faixa {tier} ({TIER_LABEL[tier]})
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={() => void suggest("all")}
          disabled={loading != null}
          title={NOTE}
          className="flex items-center gap-1.5 rounded-full border border-primary/60 px-3 py-1 font-mono text-[0.6rem] tracking-[0.14em] text-primary uppercase transition-colors hover:bg-primary/10 disabled:opacity-50"
        >
          {loading === "all" ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Wand2 className="size-3" />
          )}
          sugerir valores
        </button>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {FIELDS.map((f) => {
          const value = params[f.id];
          const source = sources[f.id];
          const range =
            tier && f.id !== "fee_pct"
              ? rangeLabel(TIER_RANGES[tier][f.id === "spread_pct" ? "spread" : "slippage"])
              : null;
          return (
            <label key={f.id} className="tv-plate flex flex-col gap-1 px-3 py-2.5" title={f.hint}>
              <span className="text-[0.58rem] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                {f.label} (%)
              </span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  inputMode="decimal"
                  placeholder="premissa do motor"
                  value={value == null ? "" : Number((value * 100).toFixed(4))}
                  onChange={(e) => {
                    const raw = e.target.value;
                    onFieldChange(f.id, raw === "" ? null : Number(raw) / 100);
                  }}
                  className="w-full min-w-0 rounded-sm border border-border/70 bg-background/60 px-2 py-1 font-mono text-sm tabular-nums text-foreground outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => void suggest(f.id)}
                  disabled={loading != null}
                  aria-label={`sugerir ${f.label}`}
                  title={NOTE}
                  className="shrink-0 rounded-sm border border-border/70 p-1 text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  {loading === f.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="size-3.5" />
                  )}
                </button>
              </div>
              <span
                className={cn(
                  "font-mono text-[0.58rem] tracking-[0.08em] uppercase",
                  source === "sugerido"
                    ? "text-primary"
                    : source === "manual"
                      ? "text-warning"
                      : "text-muted-foreground",
                )}
              >
                {source === "sugerido"
                  ? `sugestão automática${range ? ` · faixa ${range}` : ""}`
                  : source === "manual"
                    ? "preenchido manualmente"
                    : "usando premissa do motor"}
              </span>
            </label>
          );
        })}
      </div>

      <p className="mt-2 font-mono text-[0.62rem] text-muted-foreground">
        {NOTE}. A sugestão nunca grava sozinha e nunca altera os valores protegidos do motor
        (+0,55% bruto, −0,55% no limite de perda, janela de 180s).
      </p>
    </div>
  );
}
