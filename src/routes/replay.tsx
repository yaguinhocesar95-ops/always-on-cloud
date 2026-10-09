import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";

import { PAIRS } from "@/lib/binance";
import {
  detectRegimes,
  fetchCandles,
  replayCandles,
  splitByTime,
  tradesToCsv,
  walkForward,
  REASON_LABEL,
  SPLIT_LABEL,
  type Candle,
  type ReplayResult,
} from "@/lib/replay";
import {
  AMBIGUITY_POLICIES,
  AMBIGUITY_POLICY_LABEL,
  computeMetrics,
  fmtNum,
  fmtPct,
  type AmbiguityPolicy,
  type Metrics,
} from "@/lib/metrics";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/replay")({
  head: () => ({
    meta: [
      { title: "Ypx Bet — Simulador histórico" },
      {
        name: "description",
        content:
          "Simulação histórica da mesma estratégia em intervalos de 1 segundo, com separação entre treino, validação e teste e custos incluídos.",
      },
      {
        property: "og:title",
        content: "Ypx Bet — Simulador histórico",
      },
      {
        property: "og:description",
        content:
          "Simulação histórica com taxas, diferença entre compra e venda, variação de execução e atraso; modo padrão comparado ao modo com filtros.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReplayPage,
});

const MINUTE_OPTIONS = [30, 60, 120, 240];

type RunState = {
  baseline: ReplayResult;
  filtered: ReplayResult;
  candles: Candle[];
};

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

function MetricsBlock({ title, m }: { title: string; m: Metrics }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-4">
      <h4 className="mb-2 text-sm font-semibold tracking-wide text-primary">{title}</h4>
      <MetricRow label="operações" value={fmtNum(m.sample, 0)} />
      <MetricRow label="acertos" value={fmtPct(m.hitRate)} />
      <MetricRow label="acerto p/ empatar" value={fmtPct(m.breakevenHitRate)} />
      <MetricRow label="expectativa líquida" value={fmtPct(m.expectancy, 3)} />
      <MetricRow label="fator de lucro" value={fmtNum(m.profitFactor)} />
      <MetricRow label="rebaixamento máximo" value={fmtPct(m.maxDrawdown, 3)} />
      <MetricRow label="pior sequência de perdas" value={fmtNum(m.worstLosingStreak, 0)} />
      <MetricRow label="ambíguas" value={fmtNum(m.ambiguousCount, 0)} />
      {m.lowSignificance && <p className="mt-2 text-xs text-amber-500/90">{m.significanceNote}</p>}
    </div>
  );
}

function ReplayPage() {
  const [symbol, setSymbol] = useState<string>(PAIRS[0]?.symbol ?? "BTCBRL");
  const [minutes, setMinutes] = useState(60);
  const [policy, setPolicy] = useState<AmbiguityPolicy>("conservadora");
  const [assumeBook, setAssumeBook] = useState(true);
  const [run, setRun] = useState<RunState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const candles = await fetchCandles(symbol, minutes);
      if (candles.length < 300) {
        setError("Dados insuficientes no período escolhido — não dá para concluir nada.");
        setRun(null);
        return;
      }
      setRun({
        candles,
        baseline: replayCandles(symbol, candles, { mode: "baseline", assumeBook }),
        filtered: replayCandles(symbol, candles, { mode: "stable-cluster", assumeBook }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao buscar o histórico.");
      setRun(null);
    } finally {
      setBusy(false);
    }
  }, [symbol, minutes, assumeBook]);

  const baselineMetrics = useMemo(
    () => (run ? computeMetrics(run.baseline.trades, policy) : null),
    [run, policy],
  );
  const filteredMetrics = useMemo(
    () => (run ? computeMetrics(run.filtered.trades, policy) : null),
    [run, policy],
  );
  const splits = useMemo(() => (run ? splitByTime(run.baseline, policy) : []), [run, policy]);
  const folds = useMemo(() => (run ? walkForward(run.baseline, 4, policy) : []), [run, policy]);
  const regimes = useMemo(() => (run ? detectRegimes(run.candles) : []), [run]);

  const downloadCsv = useCallback(() => {
    if (!run) return;
    const csv = tradesToCsv([...run.baseline.trades, ...run.filtered.trades]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `replay-${symbol}-${minutes}min.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [run, symbol, minutes]);

  const time = (t: number) =>
    new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 pb-16">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-primary">Simulador histórico</h1>
        <p className="text-sm text-muted-foreground">
          Simulação histórica com velas de 1 segundo, o mesmo motor da tela ao vivo e todos os
          custos embutidos (taxa, escorregamento estimado, atraso e passo de preço). Nenhuma ordem é
          enviada. Desempenho passado não garante resultado futuro.
        </p>
      </header>

      <section className="flex flex-wrap items-end gap-3 rounded-lg border border-border/60 bg-card/60 p-4">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          par
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            {PAIRS.map((p) => (
              <option key={p.symbol} value={p.symbol}>
                {p.symbol}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          período
          <select
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          >
            {MINUTE_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          vela ambígua
          <div className="flex gap-1">
            {AMBIGUITY_POLICIES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPolicy(p)}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs",
                  p === policy
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground",
                )}
              >
                {AMBIGUITY_POLICY_LABEL[p]}
              </button>
            ))}
          </div>
        </div>
        <label className="flex max-w-xs flex-col gap-1 text-xs text-muted-foreground">
          livro de ofertas (não existe no histórico)
          <button
            type="button"
            onClick={() => setAssumeBook((v) => !v)}
            className={cn(
              "rounded-md border px-2 py-1 text-left text-xs",
              assumeBook ? "border-primary text-primary" : "border-border text-muted-foreground",
            )}
          >
            {assumeBook
              ? "usar diferença estimada entre compra e venda"
              : "sem livro: filtros bloqueiam (conservador)"}
          </button>
        </label>
        <button
          type="button"
          onClick={() => void execute()}
          disabled={busy}
          className="rounded-md border border-primary px-3 py-2 text-sm font-medium text-primary disabled:opacity-50"
        >
          {busy ? "processando…" : "iniciar simulação"}
        </button>
        {run && (
          <button
            type="button"
            onClick={downloadCsv}
            className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground"
          >
            exportar CSV
          </button>
        )}
      </section>

      {error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          {error}
        </p>
      )}

      {run && baselineMetrics && filteredMetrics && (
        <>
          <section className="rounded-lg border border-border/60 bg-card/60 p-4 text-sm">
            <h2 className="mb-2 font-semibold text-primary">Cobertura dos dados</h2>
            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <MetricRow label="velas de 1 s" value={fmtNum(run.baseline.candles, 0)} />
              <MetricRow
                label="período"
                value={`${time(run.baseline.from)} – ${time(run.baseline.to)}`}
              />
              <MetricRow label="segundos avaliados" value={fmtNum(run.baseline.evaluated, 0)} />
              <MetricRow
                label="segundos liberados pelo modo padrão"
                value={fmtNum(run.baseline.baselineReady, 0)}
              />
              <MetricRow label="sinais no modo padrão" value={fmtNum(run.baseline.signals, 0)} />
              <MetricRow label="sinais com filtros" value={fmtNum(run.filtered.signals, 0)} />
              <MetricRow label="expirados (modo padrão)" value={fmtNum(run.baseline.expired, 0)} />
              <MetricRow label="ainda abertos" value={fmtNum(run.baseline.stillOpen, 0)} />
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <MetricsBlock title={`Modo padrão (${run.baseline.engineVersion})`} m={baselineMetrics} />
            <MetricsBlock
              title={`Com filtros (${run.filtered.engineVersion})`}
              m={filteredMetrics}
            />
          </section>

          <section className="rounded-lg border border-border/60 bg-card/60 p-4 text-sm">
            <h2 className="mb-2 font-semibold text-primary">Separação por tempo</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Treino e validação servem para inspecionar; o bloco de teste é o único a ser lido como
              fora da amostra. Nenhum parâmetro foi ajustado aqui.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              {splits.map((s) => (
                <MetricsBlock
                  key={s.name}
                  title={`${SPLIT_LABEL[s.name]} · ${time(s.from)}–${time(s.to)}`}
                  m={s.metrics}
                />
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-border/60 bg-card/60 p-4 text-sm">
            <h2 className="mb-2 font-semibold text-primary">Validação progressiva (modo padrão)</h2>
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1">bloco</th>
                  <th>período</th>
                  <th className="text-right">operações</th>
                  <th className="text-right">acerto</th>
                  <th className="text-right">expectativa</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {folds.map((f) => (
                  <tr key={f.index} className="border-t border-border/40">
                    <td className="py-1">{f.index}</td>
                    <td>
                      {time(f.from)}–{time(f.to)}
                    </td>
                    <td className="text-right">{fmtNum(f.trades, 0)}</td>
                    <td className="text-right">{fmtPct(f.metrics.hitRate)}</td>
                    <td className="text-right">{fmtPct(f.metrics.expectancy, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border/60 bg-card/60 p-4 text-sm">
              <h2 className="mb-2 font-semibold text-primary">Motivos de bloqueio (modo padrão)</h2>
              {Object.entries(run.baseline.blockedByReason).length === 0 ? (
                <p className="text-xs text-muted-foreground">nenhum bloqueio registrado</p>
              ) : (
                Object.entries(run.baseline.blockedByReason)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => (
                    <MetricRow key={k} label={REASON_LABEL[k] ?? k} value={fmtNum(v, 0)} />
                  ))
              )}
            </div>
            <div className="rounded-lg border border-border/60 bg-card/60 p-4 text-sm">
              <h2 className="mb-2 font-semibold text-primary">
                Sinais descartados por cada filtro
              </h2>
              {Object.entries(run.filtered.blockedByFilter).length === 0 ? (
                <p className="text-xs text-muted-foreground">nenhum descarte registrado</p>
              ) : (
                Object.entries(run.filtered.blockedByFilter)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => <MetricRow key={k} label={k} value={fmtNum(v, 0)} />)
              )}
            </div>
          </section>

          <section className="rounded-lg border border-border/60 bg-card/60 p-4 text-sm">
            <h2 className="mb-2 font-semibold text-primary">
              Mudança de comportamento (blocos de 15 min)
            </h2>
            <div className="flex flex-wrap gap-2 text-xs">
              {regimes.map((r) => (
                <span key={r.from} className="rounded-md border border-border px-2 py-1 font-mono">
                  {time(r.from)} · {r.regime} · {fmtNum(r.rangePct, 2)}%
                </span>
              ))}
            </div>
          </section>
        </>
      )}

    </div>
  );
}
