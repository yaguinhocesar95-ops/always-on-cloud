import { useState } from "react";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { Star } from "lucide-react";
import type { ScoredRow } from "@/hooks/supremoScoring";
import { LIVE_BLOCK_LABEL } from "@/lib/supremo";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { REGIME_LABEL, type RegimeReading } from "@/lib/market-regime";
import { WhyNoBet } from "@/components/WhyNoBet";

const pct = (v: number | null | undefined, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d).replace(".", ",")}%`);
const hhmm = (t: number) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Painel "Melhor aposta agora": 5 melhores candidatas Supremo por pontuação. */
export function BestBetPanel({
  rows,
  nextPick,
  scannedAt,
  fmtPrice,
  onBet,
  onRefresh,
  regime,
}: {
  regime?: RegimeReading | null;
  rows: ScoredRow[];
  nextPick: string | null;
  scannedAt: number | null;
  fmtPrice: (v: number | null) => string;
  onBet: (symbol: string) => void;
  onRefresh?: () => void;
}) {
  const top = rows.slice(0, 5);
  const [sel, setSel] = useState<string | null>(null);
  const selected = top.find((r) => r.symbol === (sel ?? top[0]?.symbol)) ?? null;

  return (
    <section className="rounded-[calc(1rem-2px)] bg-card p-5 font-sans text-xs">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="tv-headline text-base text-primary">Melhor aposta agora</h2>
          <p className="text-muted-foreground">
            {nextPick ? (
              <>Será a próxima aposta: <span className="font-mono text-primary">{nextPick}</span></>
            ) : (
              "Aguardando melhor oportunidade"
            )}
            {scannedAt && <> · leitura {hhmm(scannedAt)}</>}
          </p>
        </div>
        {regime && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5",
                    regime.regime === "queda" ? "bg-warning/15 text-warning" : regime.regime === "calmo" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
                  )}
                >
                  {REGIME_LABEL[regime.regime]}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                BTC 15/60 min: {pct(regime.btc15, 2)} / {pct(regime.btc60, 2)} · ETH: {pct(regime.eth15, 2)} / {pct(regime.eth60, 2)} · moedas em queda (&gt; 0,30% em 15 min): {pct(regime.breadthDown)}.
                Em queda nenhuma aposta nova é criada; em alta só moedas com histórico acima do ponto de equilíbrio da combinação (amostra ≥ 5).
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {onRefresh && (
          <button onClick={onRefresh} className="rounded-md border border-border px-2 py-1 text-muted-foreground hover:bg-muted">
            Atualizar
          </button>
        )}
      </header>

      {regime?.regime === "queda" && (
        <p className="mb-3 rounded-md border border-warning bg-warning/10 px-2 py-1.5 text-warning">Mercado em queda: apostas pausadas</p>
      )}
      {top.length === 0 ? (
        <p className="text-muted-foreground">Calculando estatísticas das moedas…</p>
      ) : (
        <TooltipProvider>
          <ul className="space-y-2">
            {top.map((r) => {
              const rep = r.report!;
              const p = rep.principal;
              const n = p.alvos + p.stops;
              const dist = r.price != null ? (r.price - rep.plan.trigger) / rep.plan.trigger : null;
              const badge =
                p.amostra !== "ok"
                  ? { text: "Amostra pequena", cls: "bg-muted text-muted-foreground" }
                  : rep.esperado.dentro
                    ? { text: "Dentro do comportamento esperado", cls: "bg-success/15 text-success" }
                    : { text: "Fora do padrão", cls: "bg-warning/15 text-warning" };
              return (
                <li
                  key={r.symbol}
                  onClick={() => setSel(r.symbol)}
                  className={cn(
                    "cursor-pointer rounded-lg border p-2.5 transition-colors",
                    selected?.symbol === r.symbol ? "border-primary/60 bg-primary/5" : "border-border hover:bg-muted/30",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex items-center gap-0.5" aria-label={`${rep.estrelas} estrelinhas`}>
                      {[1, 2, 3, 4, 5].map((i) => (
                        <Star key={i} className={cn("h-3.5 w-3.5", i <= rep.estrelas ? "fill-gold text-gold" : "text-muted-foreground/40")} />
                      ))}
                    </span>
                    <span className="font-mono text-foreground">{rep.pontuacao}</span>
                    <span className="font-mono font-semibold text-foreground">{r.symbol}</span>
                    <span className="font-mono text-muted-foreground">{fmtPrice(r.price)}</span>
                    <span className="font-mono text-muted-foreground">até o gatilho: {pct(dist, 2)}</span>
                    {r.symbol === nextPick && <span className="rounded bg-primary/15 px-1.5 py-0.5 text-primary">Será a próxima aposta</span>}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className={cn("rounded px-1.5 py-0.5", badge.cls)}>{badge.text}</span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Índice atual {rep.indiceAtual} está no percentil {Math.round(rep.esperado.percentil ?? 0)} das últimas 24 h
                        (esperado entre 25 e 90).
                      </TooltipContent>
                    </Tooltip>
                    {r.blocks.length > 0 && (
                      <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive">
                        {r.blocks.map((b) => LIVE_BLOCK_LABEL[b]).join(", ")}
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 grid gap-x-4 gap-y-0.5 font-mono text-[0.68rem] text-muted-foreground sm:grid-cols-2">
                    <span>
                      gatilho {fmtPrice(rep.plan.trigger)} · alvo {fmtPrice(rep.plan.target)} · stop {fmtPrice(rep.plan.stop)}
                    </span>
                    <span>
                      No ímã 1h / 3h / 6h: {rep.toquesNoIma[1]} / {rep.toquesNoIma[3]} / {rep.toquesNoIma[6]} toques
                    </span>
                    <span>
                      Ciclos que deram alvo: {p.alvos} de {n} ({pct(p.taxaAcerto)} · Wilson {pct(p.wilsonLow)})
                    </span>
                    <span>
                      Tempo mediano até alvo: {p.tempoMedianoAteAlvo == null ? "—" : `${Math.round(p.tempoMedianoAteAlvo)} min`}
                    </span>
                  </div>
                  <div className="mt-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onBet(r.symbol);
                      }}
                      disabled={r.blocks.length > 0}
                      className="rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                    >
                      Apostar nesta
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {selected?.report && (
            <div className="mt-3 rounded-lg border border-border p-2">
              <p className="mb-1 text-muted-foreground">Índice por hora — {selected.symbol} (últimas 24 h)</p>
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={selected.report.indicesHora.map((h) => ({ h: hhmm(h.hourStart), v: h.index }))}>
                    <XAxis dataKey="h" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} interval={3} />
                    <YAxis tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} width={24} />
                    <RTooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", fontSize: 11 }} />
                    <Bar dataKey="v" name="índice">
                      {selected.report.indicesHora.map((_, i, a) => (
                        <Cell key={i} fill={i === a.length - 1 ? "var(--gold)" : "var(--primary)"} />
                      ))}
                    </Bar>
                    {selected.report.indiceMediana != null && (
                      <ReferenceLine y={selected.report.indiceMediana} stroke="var(--muted-foreground)" strokeDasharray="4 3" />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-1 text-[0.65rem] text-muted-foreground">{selected.report.motivo}</p>
            </div>
          )}
        </TooltipProvider>
      )}
      <WhyNoBet />
      <p className="mt-3 text-[0.65rem] text-muted-foreground">Estatística de comportamento passado; não garante resultado.</p>
    </section>
  );
}
