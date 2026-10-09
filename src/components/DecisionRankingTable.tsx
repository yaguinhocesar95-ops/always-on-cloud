/**
 * Ranking de decisão — só leitura. Reaproveita o motor (stable-cluster), as
 * métricas do ímã e os filtros já calculados; não dispara apostas.
 */
import { useMemo } from "react";
import { Info, ShieldAlert, TrendingUp, Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { RankedPairInfo } from "@/hooks/usePairRanking";
import { blockingFilters } from "@/lib/filters";
import { STABLE_MAX_DRIFT_PCT, type MagnetMetrics } from "@/lib/magnet-metrics";
import type { ScalpEngine } from "@/lib/scalp";
import { cn } from "@/lib/utils";

type Rec = "Entrar" | "Aguardar" | "Evitar";

type Row = {
  pair: RankedPairInfo;
  price: number | null;
  magnet: number | null;
  trigger: number | null;
  distPct: number | null;
  robustness: number | null;
  passed: number;
  total: number;
  confidence: number;
  rec: Rec;
  blockReason: string | null;
};

/** Robustez do ímã (0..1) derivada de MagnetMetrics — o código não tem um "robustnessScore" pronto. */
function robustnessOf(m: MagnetMetrics | null): number | null {
  if (!m) return null;
  const conc = Math.min(1, m.concentration / 0.3);
  const gap = Math.min(1, m.gapToSecond / 0.05);
  const drift =
    m.stabilityDriftPct == null ? 0.5 : Math.max(0, 1 - m.stabilityDriftPct / STABLE_MAX_DRIFT_PCT);
  const base = 0.4 * conc + 0.3 * gap + 0.3 * drift;
  return m.edgeSensitive ? base * 0.8 : base;
}

const fmtNum = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { maximumSignificantDigits: 6 });

/** Linha do ranking de decisão (mesma nota exibida na tabela). */
export function decisionRow(pair: RankedPairInfo, e: ScalpEngine, livePrices: Map<string, number>): Row {
  const price = livePrices.get(pair.symbol) ?? e.price;
  const trigger = e.entryTrigger;
  const distPct = price != null && trigger != null && price > 0 ? ((price - trigger) / price) * 100 : null;
  const robustness = robustnessOf(e.metrics);
  const measurable = e.filters.filter((f) => f.status !== "unavailable");
  const passed = measurable.filter((f) => f.status === "pass").length;
  const total = measurable.length;
  const proximity = distPct == null ? 0 : Math.max(0, 1 - Math.abs(distPct) / 0.55);
  const confidence = Math.round(
    100 * (0.5 * (robustness ?? 0) + 0.3 * proximity + 0.2 * (total > 0 ? passed / total : 0)),
  );
  const blocks = blockingFilters(e.filters);
  const blockReason = blocks.length > 0 ? blocks.map((b) => `${b.label} (${b.detail})`).join("; ") : null;
  const rec: Rec = blockReason
    ? "Evitar"
    : confidence >= 70 && distPct != null && Math.abs(distPct) <= 0.15
  ? "Entrar"
  : "Aguardar";
  return { pair, price, magnet: e.magnetPrice, trigger, distPct, robustness, passed, total, confidence, rec, blockReason };
}

export function DecisionRankingTable({
  pairs,
  engines,
  livePrices,
  limit = 8,
}: {
  pairs: readonly RankedPairInfo[];
  engines: Map<string, ScalpEngine>;
  livePrices: Map<string, number>;
  limit?: number;
}) {
  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const pair of pairs) {
      if (pair.quote !== "USDT") continue;
      const e = engines.get(pair.symbol);
      if (!e) continue;
      out.push(decisionRow(pair, e, livePrices));
    }
    out.sort((a, b) => b.confidence - a.confidence);
    return out.slice(0, limit);
  }, [pairs, engines, livePrices, limit]);

  return (
    <TooltipProvider delayDuration={150}>
      <section className="tv-panel p-6">
        <div className="relative z-10">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="tv-headline text-[0.95rem] text-foreground">Ranking de decisão</h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="Como a confiança é calculada" className="text-muted-foreground hover:text-foreground">
                  <Info className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Confiança = 50% robustez do ímã + 30% proximidade do preço ao gatilho + 20% filtros
                aprovados. Par bloqueado por filtro vai direto para "Evitar". Só leitura.
              </TooltipContent>
            </Tooltip>
          </div>
          {rows.length === 0 ? (
            <p className="font-sans text-xs text-muted-foreground">Carregando histórico dos pares…</p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="font-mono text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead>Par</TableHead>
                    <TableHead className="text-right">Preço</TableHead>
                    <TableHead className="text-right">Ímã (alvo)</TableHead>
                    <TableHead className="text-right">Gatilho</TableHead>
                    <TableHead className="text-right">Dist. gatilho</TableHead>
                    <TableHead className="text-right">Robustez</TableHead>
                    <TableHead className="text-right">Filtros</TableHead>
                    <TableHead className="text-right">Confiança</TableHead>
                    <TableHead>Recomendação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={r.pair.symbol} className={cn(i === 0 && "bg-primary/10 font-bold")}>
                      <TableCell>{r.pair.base}/{r.pair.quote}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.price)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.magnet)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtNum(r.trigger)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.distPct == null ? "—" : `${r.distPct.toFixed(3).replace(".", ",")}%`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.robustness == null ? "—" : Math.round(r.robustness * 100)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.passed}/{r.total}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.confidence}</TableCell>
                      <TableCell>
                        {r.rec === "Evitar" ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="destructive" className="gap-1">
                                <ShieldAlert className="size-3" /> Evitar
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs">{r.blockReason}</TooltipContent>
                          </Tooltip>
                        ) : r.rec === "Entrar" ? (
                          <Badge className="gap-1 bg-success text-background">
                            <TrendingUp className="size-3" /> Entrar
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1">
                            <Clock className="size-3" /> Aguardar
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </section>
    </TooltipProvider>
  );
}
