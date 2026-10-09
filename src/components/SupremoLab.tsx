import { useEffect, useMemo, useRef, useState } from "react";
import { FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ExpectancyLab } from "@/components/ExpectancyLab";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { fetchPairs } from "@/lib/binance";
import type { Candle } from "@/lib/replay";
import { suggestionForTier, tierFromRank } from "@/lib/cost-tiers";
import { BAND_PCT, HOUR_MS, runBacktest } from "@/lib/supremo";
import { getClosedHour, mapSettled } from "@/lib/supremo-data";
import {
  CURRENT_STOP_PCT,
  CURRENT_TARGET_PCT,
  DEFAULT_GRID,
  LAB_MIN_SAMPLE,
  LAB_STRONG_SAMPLE,
  MAX_COMBOS,
  buildGrid,
  candidatesFromBacktest,
  comboLabel,
  evaluateCombo,
  pctLabel,
  rankCombos,
  stabilityOf,
  walkForward,
  type ComboStats,
  type GridSpec,
  type LabCandidate,
  type LabMode,
  type WalkForward,
  breakEvenTable,
  withExtraCombos,
  TIME_EXIT_MS,
  type BreakEvenRow,
} from "@/lib/target-stop-lab";
import { DEFAULT_COMBO, readActiveCombo, writeActiveCombo, type ActiveCombo } from "@/lib/supremo-combo";
import { cn } from "@/lib/utils";

type Result = {
  mode: LabMode;
  targets: number[];
  stops: number[];
  stats: ComboStats[];
  current: ComboStats;
  wf: WalkForward;
  candidates: number;
};

const sp = (v: number | null, d = 3) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d).replace(".", ",")}%`);
const pc = (v: number | null, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d).replace(".", ",")}%`);
const dur = (ms: number | null) => (ms == null ? "—" : ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${(ms / 60_000).toFixed(1).replace(".", ",")} min`);
const sample = (n: number) => (n < LAB_MIN_SAMPLE ? "amostra pequena" : n >= LAB_STRONG_SAMPLE ? "amostra forte" : "amostra moderada");

function tip(s: ComboStats) {
  return [
    comboLabel(s.targetPct, s.stopPct),
    `executadas ${s.executed} (${s.wins} vitórias / ${s.losses} derrotas, ${s.ambiguous} ambíguas)`,
    `não executadas ${s.notExecuted} · sem desfecho ${s.unresolved}`,
    `acerto ${pc(s.hitRate)} (Wilson ${pc(s.wilson?.low ?? null)}–${pc(s.wilson?.high ?? null)})`,
    `equilíbrio ${pc(s.breakeven)} · margem ${sp(s.margin, 1)}`,
    `ganho líq. ${sp(s.avgNetWin)} · perda líq. ${sp(s.avgNetLoss)}`,
    `expectativa ${sp(s.expectancy)} · pessimista ${sp(s.expectancyWilsonLow)}`,
    `acumulado ${sp(s.totalReturn, 2)} · tempo médio ${dur(s.avgResolveMs)}`,
  ].join("\n");
}

type SortKey = "wl" | "exp" | "hit" | "n" | "total" | "time";
const SORTS: { key: SortKey; label: string; get: (s: ComboStats) => number }[] = [
  { key: "n", label: "Exec.", get: (s) => s.executed },
  { key: "hit", label: "Acerto", get: (s) => s.hitRate ?? -1 },
  { key: "exp", label: "Expect.", get: (s) => s.expectancy ?? -1 },
  { key: "wl", label: "Pessimista", get: (s) => s.expectancyWilsonLow ?? -1 },
  { key: "total", label: "Acumulado", get: (s) => s.totalReturn },
  { key: "time", label: "Tempo", get: (s) => -(s.avgResolveMs ?? Infinity) },
];

export function SupremoLab() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<ActiveCombo>(DEFAULT_COMBO);
  useEffect(() => {
    const sync = () => setActive(readActiveCombo());
    sync();
    window.addEventListener("supremo-combo", sync);
    return () => window.removeEventListener("supremo-combo", sync);
  }, []);
  const isDefault = active.targetPct === CURRENT_TARGET_PCT && active.stopPct === CURRENT_STOP_PCT && active.mode === "percentual";

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
      <span className="font-sans text-xs text-muted-foreground">
        Combinação em uso: <b className="text-foreground">{comboLabel(active.targetPct, active.stopPct, active.mode)}</b>
        {!isDefault && (
          <button className="ml-2 underline" onClick={() => { writeActiveCombo(null); toast.success("Voltou para alvo +0,55% / stop −0,55%."); }}>
            voltar ao padrão
          </button>
        )}
      </span>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <FlaskConical className="size-4" /> Laboratório de Alvo e Stop
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Laboratório de Alvo e Stop</DialogTitle>
            <DialogDescription>
              Testa combinações de alvo e stop nas mesmas apostas do backtest por hora do Supremo, com velas reais de 1 s e custos. Não muda as apostas reais até você clicar em “Aplicar esta combinação”.
            </DialogDescription>
          </DialogHeader>
          <LabBody />
          <div className="mt-6 border-t border-border pt-5">
            <ExpectancyLab />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LabBody() {
  const [period, setPeriod] = useState(6);
  const [mode, setMode] = useState<LabMode>("percentual");
  const [grid, setGrid] = useState<GridSpec>(DEFAULT_GRID);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [sort, setSort] = useState<SortKey>("wl");
  const [confirm, setConfirm] = useState<ComboStats | null>(null);
  const [timeExitOn, setTimeExitOn] = useState(false);
  const [timeExit, setTimeExit] = useState<{ without: ComboStats; with: ComboStats } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const cache = useRef<{ key: string; cands: LabCandidate[] } | null>(null);

  const { targets, stops } = useMemo(() => buildGrid(grid, mode), [grid, mode]);
  const combos = targets.length * stops.length;
  const tooMany = combos > MAX_COMBOS || combos === 0;

  useEffect(() => () => abort.current?.abort(), []);

  const loadCandidates = async (signal: AbortSignal): Promise<LabCandidate[]> => {
    const t = Date.now();
    const cur = Math.floor(t / HOUR_MS) * HOUR_MS;
    const key = `${cur}-${period}`;
    if (cache.current?.key === key) return cache.current.cands;
    setBusy("Baixando velas de 1 s das moedas do painel…");
    const pairs = await fetchPairs();
    const hourStarts = Array.from({ length: period }, (_, i) => cur - (period - i) * HOUR_MS);
    const res = await mapSettled(
      pairs,
      async (p) => {
        const hours: Candle[][] = [];
        for (const h of hourStarts) hours.push(await getClosedHour(p.symbol, h, signal));
        return hours;
      },
      (done) => setProgress(done / pairs.length),
      signal,
    );
    const coins = pairs.flatMap((p, i) => {
      const r = res[i];
      return r && r.ok ? [{ symbol: p.symbol, hours: r.value, rank: i + 1 }] : [];
    });
    const rank = new Map(coins.map((c) => [c.symbol, c.rank]));
    const bt = runBacktest(coins, hourStarts, BAND_PCT, (s) => {
      const sg = suggestionForTier(tierFromRank(rank.get(s) ?? 100));
      return { fee: sg.fee_pct * 2, spread: sg.spread_pct };
    });
    const cands = candidatesFromBacktest(bt.chosen, coins, hourStarts);
    cache.current = { key, cands };
    return cands;
  };

  const run = async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(null);
    setProgress(0);
    try {
      const cands = await loadCandidates(ctrl.signal);
      if (cands.length === 0) throw new Error("Nenhuma aposta candidata no período.");
      setBusy(`Testando ${combos} combinações em ${cands.length} apostas…`);
      const stats: ComboStats[] = [];
      const pairs = withExtraCombos(targets.flatMap((t) => stops.map((s) => [t, s] as const)));
      for (let i = 0; i < pairs.length; i++) {
        if (ctrl.signal.aborted) throw new DOMException("cancelado", "AbortError");
        stats.push(evaluateCombo(cands, pairs[i]![0], pairs[i]![1], mode));
        if (i % 8 === 7) {
          setProgress((i + 1) / pairs.length);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      setBusy("Validando com walk-forward…");
      await new Promise((r) => setTimeout(r, 0));
      const wf = walkForward(cands, targets, stops, mode);
      const current = evaluateCombo(cands, CURRENT_TARGET_PCT, CURRENT_STOP_PCT, "percentual");
      const currentTimeExit = evaluateCombo(cands, CURRENT_TARGET_PCT, CURRENT_STOP_PCT, "percentual", { timeExitMs: TIME_EXIT_MS });
      setResult({ mode, targets, stops, stats, current, wf, candidates: cands.length });
      setTimeExit(timeExitOn ? { without: current, with: currentTimeExit } : null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
      else toast("Teste cancelado.");
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const beTable = useMemo(() => (result ? breakEvenTable(result.stats) : null), [result]);
  const ranked = useMemo(() => (result ? rankCombos(result.stats) : []), [result]);
  const best = ranked[0] ?? null;
  const stab = useMemo(() => (result && best ? stabilityOf(best, result.stats, result.targets, result.stops) : null), [result, best]);
  const top10 = useMemo(() => {
    const g = SORTS.find((s) => s.key === sort)!.get;
    return [...ranked].sort((a, b) => g(b) - g(a)).slice(0, 10);
  }, [ranked, sort]);
  const maxAbs = useMemo(
    () => Math.max(1e-9, ...(result?.stats.map((s) => Math.abs(s.expectancy ?? 0)) ?? [0])),
    [result],
  );

  const field = (label: string, k: keyof GridSpec, disabled = false) => (
    <label className="flex flex-col gap-1 text-[0.65rem] text-muted-foreground">
      {label}
      <input
        type="number"
        step="0.05"
        disabled={disabled}
        value={Number((grid[k] * 100).toFixed(2))}
        onChange={(e) => setGrid({ ...grid, [k]: Number(e.target.value) / 100 })}
        className="w-20 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground disabled:opacity-40"
      />
    </label>
  );

  return (
    <div className="space-y-5 text-sm">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
        <label className="flex items-center gap-1.5 text-[0.65rem] text-muted-foreground">
          <input type="checkbox" checked={timeExitOn} onChange={(e) => setTimeExitOn(e.target.checked)} />
          Simular saída por tempo (15 min no prejuízo)
        </label>
        <label className="flex flex-col gap-1 text-[0.65rem] text-muted-foreground">
          Período (horas)
          <select value={period} onChange={(e) => setPeriod(Number(e.target.value))} className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground">
            {[6, 12, 24, 48, 72].map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[0.65rem] text-muted-foreground">
          Alvo
          <select value={mode} onChange={(e) => setMode(e.target.value as LabMode)} className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground">
            <option value="percentual">percentual (gatilho = ímã ÷ (1 + alvo))</option>
            <option value="fixo-ima">fixo no ímã (só o stop varia)</option>
          </select>
        </label>
        {field("Alvo de (%)", "targetFrom", mode === "fixo-ima")}
        {field("até (%)", "targetTo", mode === "fixo-ima")}
        {field("passo (%)", "targetStep", mode === "fixo-ima")}
        {field("Stop de (%)", "stopFrom")}
        {field("até (%)", "stopTo")}
        {field("passo (%)", "stopStep")}
        <div className="ml-auto flex items-center gap-2">
          <span className={cn("font-mono text-xs", tooMany ? "text-destructive" : "text-muted-foreground")}>
            {combos} combinações{combos > MAX_COMBOS ? ` (máx. ${MAX_COMBOS})` : ""}
          </span>
          {busy ? (
            <Button size="sm" variant="outline" onClick={() => abort.current?.abort()}>Cancelar</Button>
          ) : (
            <Button size="sm" disabled={tooMany} onClick={run}>Rodar teste</Button>
          )}
        </div>
      </div>

      {busy && (
        <div>
          <p className="text-xs text-muted-foreground">{busy}</p>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
          </div>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {result && (
        <>
          <p className="text-xs text-muted-foreground">
            {result.candidates} apostas candidatas (regra Supremo: maior índice da hora anterior). Toque ambíguo = derrota; não executada e sem desfecho ficam fora da conta.
          </p>

          {/* Mapa de calor */}
          <div>
            <h3 className="mb-2 font-semibold text-foreground">Mapa de calor — expectativa líquida por aposta</h3>
            <div className="overflow-x-auto">
              <table className="border-separate border-spacing-0.5 font-mono text-[0.6rem]">
                <thead>
                  <tr>
                    <th className="px-1 text-left text-muted-foreground">stop ↓ / alvo →</th>
                    {result.targets.map((t) => <th key={t} className="px-1 text-muted-foreground">{pctLabel(t)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {result.stops.map((s) => (
                    <tr key={s}>
                      <td className="pr-1 text-muted-foreground">{pctLabel(s)}</td>
                      {result.targets.map((t) => {
                        const c = result.stats.find((x) => x.targetPct === t && x.stopPct === s)!;
                        const e = c.expectancy;
                        const op = e == null ? 0 : 0.15 + 0.85 * Math.min(1, Math.abs(e) / maxAbs);
                        const isBest = best && best.targetPct === t && best.stopPct === s;
                        return (
                          <td
                            key={t}
                            title={tip(c)}
                            onClick={() => setConfirm(c)}
                            className={cn(
                              "relative h-7 min-w-12 cursor-pointer rounded-sm px-1 text-center text-foreground",
                              isBest && "ring-2 ring-primary",
                            )}
                          >
                            <span
                              className={cn("absolute inset-0 rounded-sm", e == null ? "bg-muted" : e >= 0 ? "bg-success" : "bg-destructive")}
                              style={{ opacity: e == null ? 0.4 : op }}
                            />
                            <span className="relative">{e == null ? "—" : sp(e, 2)}</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[0.65rem] text-muted-foreground">Passe o mouse para ver todas as métricas; clique para aplicar.</p>
          </div>

          {/* Avisos */}
          <div className="flex flex-wrap gap-2 text-xs">
            {best ? (
              <>
                <span className={cn("rounded-full border px-2 py-0.5", best.executed >= LAB_STRONG_SAMPLE ? "border-success text-success" : "border-warning text-warning")}>
                  melhor: {sample(best.executed)} ({best.executed})
                </span>
                {stab?.overfit && <span className="rounded-full border border-destructive px-2 py-0.5 text-destructive">possível sobreajuste: muito melhor que as vizinhas</span>}
                {stab && (
                  <span className={cn("rounded-full border px-2 py-0.5", stab.robust ? "border-success text-success" : "border-warning text-warning")}>
                    estabilidade: {stab.positive}/{stab.neighbors.length} vizinhas positivas — {stab.robust ? "resultado robusto" : "provavelmente acaso"}
                  </span>
                )}
              </>
            ) : (
              <span className="rounded-full border border-warning px-2 py-0.5 text-warning">Nenhuma combinação com {LAB_MIN_SAMPLE}+ apostas executadas — amostra pequena. Aumente o período.</span>
            )}
          </div>

          {beTable && <BreakEvenBoard table={beTable} />}
          {timeExit && <TimeExitBoard data={timeExit} />}

          {/* Top 10 */}
          <div>
            <h3 className="mb-2 font-semibold text-foreground">10 melhores combinações (mín. {LAB_MIN_SAMPLE} executadas)</h3>
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border text-left">
                    <th className="py-1 pr-2">Combinação</th>
                    {SORTS.map((s) => (
                      <th key={s.key} className="cursor-pointer py-1 pr-2" onClick={() => setSort(s.key)}>
                        {s.label}{sort === s.key ? " ▼" : ""}
                      </th>
                    ))}
                    <th className="py-1 pr-2">Equilíbrio</th>
                    <th className="py-1 pr-2">Margem</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {[{ s: result.current, current: true }, ...top10.map((s) => ({ s, current: false }))].map(({ s, current }) => (
                    <tr key={`${current}-${s.targetPct}-${s.stopPct}`} title={tip(s)} className={cn("border-b border-border/50", current && "bg-muted/40")}>
                      <td className="py-1 pr-2">{current ? "atual · " : ""}{comboLabel(s.targetPct, s.stopPct, current ? "percentual" : result.mode)}</td>
                      <td className="pr-2">{s.executed}{s.executed < LAB_MIN_SAMPLE ? " ⚠" : ""}</td>
                      <td className="pr-2">{pc(s.hitRate)} <span className="text-muted-foreground">({pc(s.wilson?.low ?? null, 0)}–{pc(s.wilson?.high ?? null, 0)})</span></td>
                      <td className={cn("pr-2", (s.expectancy ?? 0) >= 0 ? "text-success" : "text-destructive")}>{sp(s.expectancy)}</td>
                      <td className={cn("pr-2", (s.expectancyWilsonLow ?? 0) >= 0 ? "text-success" : "text-destructive")}>{sp(s.expectancyWilsonLow)}</td>
                      <td className="pr-2">{sp(s.totalReturn, 2)}</td>
                      <td className="pr-2">{dur(s.avgResolveMs)}</td>
                      <td className="pr-2">{pc(s.breakeven)}</td>
                      <td className="pr-2">{sp(s.margin, 1)}</td>
                      <td>{!current && <button className="underline" onClick={() => setConfirm(s)}>aplicar</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Walk-forward */}
          <div className="rounded-lg border border-border p-3">
            <h3 className="font-semibold text-foreground">Walk-forward (contra sobreajuste)</h3>
            {result.wf.train && result.wf.test ? (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">1ª metade ({result.wf.trainSize} apostas) — escolhida:</p>
                  <p className="font-mono text-xs">{comboLabel(result.wf.train.targetPct, result.wf.train.stopPct, result.mode)}</p>
                  <p className="font-mono text-sm">expectativa {sp(result.wf.train.expectancy)} · {result.wf.train.executed} exec.</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">2ª metade ({result.wf.testSize} apostas, nunca vista na escolha):</p>
                  <p className="font-mono text-xs">mesma combinação</p>
                  <p className={cn("font-mono text-sm", (result.wf.test.expectancy ?? 0) >= 0 ? "text-success" : "text-destructive")}>
                    expectativa {sp(result.wf.test.expectancy)} · {result.wf.test.executed} exec.
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">Amostra insuficiente na primeira metade para escolher uma combinação.</p>
            )}
          </div>
        </>
      )}

      <AlertDialog open={confirm != null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar esta combinação?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm && comboLabel(confirm.targetPct, confirm.stopPct, result?.mode ?? "percentual")} passará a ser usada SOMENTE nas próximas apostas da trilha Supremo. Apostas já abertas ou pendentes mantêm seus valores.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirm) return;
                writeActiveCombo({ targetPct: confirm.targetPct, stopPct: confirm.stopPct, mode: result?.mode ?? "percentual" });
                toast.success(`Combinação aplicada: ${comboLabel(confirm.targetPct, confirm.stopPct, result?.mode ?? "percentual")}`);
                setConfirm(null);
              }}
            >
              Aplicar esta combinação
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const pcx = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`);

function BreakEvenBoard({ table }: { table: { rows: BreakEvenRow[]; anyPasses: boolean } }) {
  const rows = [...table.rows].sort((a, b) => Number(b.passes) - Number(a.passes) || (b.wilsonLow ?? 0) - (b.breakeven ?? 0) - ((a.wilsonLow ?? 0) - (a.breakeven ?? 0))).slice(0, 25);
  return (
    <div>
      <h3 className="mb-2 font-semibold text-foreground">Break-even por combinação</h3>
      {!table.anyPasses && (
        <p className="mb-2 rounded-md border border-warning px-2 py-1 text-xs text-warning">Nenhuma combinação supera o ponto de equilíbrio com a amostra atual</p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-xs">
          <thead className="text-muted-foreground">
            <tr><th className="text-left">Alvo / Stop</th><th className="text-left">Equilíbrio</th><th className="text-left">Acerto</th><th className="text-left">Wilson inf.</th><th className="text-left">Executadas</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.targetPct}-${r.stopPct}`} className={cn(r.passes ? "text-success" : "text-muted-foreground")}>
                <td>+{pcx(r.targetPct)} / −{pcx(r.stopPct)}</td>
                <td>{pcx(r.breakeven)}</td>
                <td>{pcx(r.hitRate)}</td>
                <td>{pcx(r.wilsonLow)}</td>
                <td>{r.executed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[0.65rem] text-muted-foreground">Verde: Wilson inferior acima do equilíbrio com 30+ executadas. A combinação ativa nunca é trocada automaticamente.</p>
    </div>
  );
}

function TimeExitBoard({ data }: { data: { without: ComboStats; with: ComboStats } }) {
  const col = (t: string, s: ComboStats) => (
    <div className="rounded-md border border-border p-2">
      <p className="text-muted-foreground">{t}</p>
      <p className="font-mono">acerto {pcx(s.hitRate)} · lucro {pcx(s.totalReturn)}</p>
    </div>
  );
  return (
    <div>
      <h3 className="mb-2 font-semibold text-foreground">Saída por tempo (simulação, combinação atual)</h3>
      <div className="grid gap-2 sm:grid-cols-2 text-xs">{col("Sem a regra", data.without)}{col("Com a regra", data.with)}</div>
      <p className="mt-1 text-[0.65rem] text-muted-foreground">Apenas simulação — não é aplicada às apostas reais.</p>
    </div>
  );
}
