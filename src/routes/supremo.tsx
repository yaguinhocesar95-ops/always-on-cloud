import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { playNotificationSound } from "@/lib/notification-sounds";
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { fetchPairs, fetchUsdtBrl, formatPrice } from "@/lib/binance";
import { fmtNum, fmtPct, type Metrics, computeMetrics, type ResolvedTrade } from "@/lib/metrics";
import { replayCandles, type Candle } from "@/lib/replay";
import { suggestionForTier, tierFromRank } from "@/lib/cost-tiers";
import { convertMoney, formatQuotePrice } from "@/lib/money";
import {
  BAND_PCT,
  DEFAULT_MIN_VOLUME_USDT,
  DEFAULT_PERIOD_HOURS,
  DEFAULT_TOP_N,
  HOUR_MS,
  LIVE_BLOCK_LABEL,
  MIN_REPETICOES,
  analyzeWindow,
  liveBlocks,
  planBet,
  rowsToCsv,
  runBacktest,
  sampleLabel,
  type BacktestResult,
  type CostOptions,
  type HourAnalysis,
  type LiveBlock,
} from "@/lib/supremo";
import {
  fetchUniverse,
  getClosedHour,
  getCurrentHour,
  mapSettled,
  type UniverseCoin,
} from "@/lib/supremo-data";
import { useAllTickerPrices } from "@/hooks/useAllTickerPrices";
import { useBets } from "@/hooks/useBets";
import { readActiveCombo } from "@/lib/supremo-combo";
import { comboLabel, planCombo } from "@/lib/target-stop-lab";
import { applyTrauma, readTrauma, traumaText, writeTrauma } from "@/lib/supremo-trauma";
import { appendAudit, exposureBlock, newId, readExposure, selectCoin } from "@/lib/supremo-live";
import { useBankroll } from "@/hooks/useBankroll";
import { BetTracker } from "@/components/BetTracker";
import { BestBetPanel } from "@/components/BestBetPanel";
import { SupremoRanking } from "@/components/SupremoRanking";
import { SupremoEconomia } from "@/components/SupremoEconomia";
import { useSupremoAuto } from "@/hooks/useSupremoAuto";
import { scoreRows } from "@/hooks/supremoScoring";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUiLayout } from "@/hooks/useUiLayout";
import { cn } from "@/lib/utils";

export const SUPREMO_STORAGE_KEY = "scalp-terminal-bets-supremo-v1";

export const Route = createFileRoute("/supremo")({
  head: () => ({
    meta: [
      { title: "Ypx Bet — Validar Aposta Supremo" },
      {
        name: "description",
        content:
          "Escolhe a moeda cuja faixa de preço mais se repetiu na última hora, com simulador histórico por hora e backtest com custos.",
      },
      { property: "og:title", content: "Ypx Bet — Validar Aposta Supremo" },
      {
        property: "og:description",
        content: "Ranking por repetição de faixa de preço, backtest hora a hora e aposta gerada ao vivo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SupremoPage,
});

type CoinData = {
  coin: UniverseCoin;
  rank: number;
  hours: Candle[][];
  current: Candle[];
  fetchedAt: number;
  incomplete: boolean;
  error: string | null;
};

type Loaded = { hourStarts: number[]; currentHourStart: number; coins: CoinData[] };

type RankRow = {
  symbol: string;
  quote: string;
  analysis: HourAnalysis;
  window: Candle[];
  price: number | null;
  distancePct: number | null;
  blocks: LiveBlock[];
  trauma: string | null;
  hist: { chosen: number; chosenWins: number; iso: number; isoWins: number } | null;
  series: { h: string; v: number | null }[];
};

const card = "rounded-lg border border-border/60 bg-card/60 p-4";
const sel = "rounded-md border border-border bg-background px-2 py-1 text-sm";

const SUP_TABS = [
  { id: "geral", label: "Visão geral" },
  { id: "moedas", label: "Moedas" },
  { id: "apostas", label: "Apostas" },
  { id: "placar", label: "Placar" },
  { id: "hora", label: "Análise por hora" },
  { id: "backtest", label: "Backtest" },
] as const;

function hhmm(t: number) {
  return new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function SupremoPage() {
  const [quote, setQuote] = useState<"USDT" | "BRL">("USDT");
  const [topN, setTopN] = useState<number | null>(-1);
  const [minVol, setMinVol] = useState(DEFAULT_MIN_VOLUME_USDT);
  const [period, setPeriod] = useState(DEFAULT_PERIOD_HOURS);
  const [bandPct, setBandPct] = useState(BAND_PCT);
  const [minRep, setMinRep] = useState(MIN_REPETICOES);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fxQuery = useQuery({ queryKey: ["usdtbrl"], queryFn: fetchUsdtBrl, refetchInterval: 60_000, staleTime: 30_000 });
  const usdtBrl = fxQuery.data ?? null;
  const livePrices = useAllTickerPrices();
  const { bankroll } = useBankroll();
  const supremo = useBets(null, null, quote, livePrices, SUPREMO_STORAGE_KEY, true);
  // Painel "Melhor aposta agora" (só leitura; o registro automático desta página é o de baixo).
  const best = useSupremoAuto({ enabled: false, placeBet: supremo.placeBet, bets: supremo.bets, bankroll, usdtBrl, livePrices });

  // Sons das apostas Supremo desta tela (estrelinha, erro e gatilho de entrada).
  useEffect(() => {
    if (supremo.justWon) { playNotificationSound("sucesso"); supremo.clearJustWon(); }
  }, [supremo.justWon, supremo.clearJustWon]);
  useEffect(() => {
    if (supremo.justLost) { playNotificationSound("erro"); supremo.clearJustLost(); }
  }, [supremo.justLost, supremo.clearJustLost]);
  useEffect(() => {
    if (supremo.justArmed) { playNotificationSound("entrada"); supremo.clearJustArmed(); }
  }, [supremo.justArmed, supremo.clearJustArmed]);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setError(null);
    try {
      const universe =
        topN === -1
          ? (await fetchPairs()).map((p) => ({ symbol: p.symbol, quote: p.quote, quoteVolume: p.quoteVolume, volumeUsdt: p.quoteVolume, price: p.price }))
          : await fetchUniverse({ quote, minVolumeUsdt: minVol, topN, usdtBrl });
      if (universe.length === 0) throw new Error("Nenhuma moeda atende ao volume mínimo.");
      const now = Date.now();
      const currentHourStart = Math.floor(now / HOUR_MS) * HOUR_MS;
      const hourStarts = Array.from({ length: period }, (_, i) => currentHourStart - (period - i) * HOUR_MS);
      setProgress({ done: 0, total: universe.length });
      const results = await mapSettled(
        universe,
        async (coin) => {
          const hours: Candle[][] = [];
          for (const h of hourStarts) hours.push(await getClosedHour(coin.symbol, h, ctrl.signal));
          const current = await getCurrentHour(coin.symbol, currentHourStart, Date.now(), ctrl.signal);
          return { hours, current, fetchedAt: Date.now() };
        },
        (done) => setProgress({ done, total: universe.length }),
        ctrl.signal,
      );
      const coins: CoinData[] = universe.map((coin, i) => {
        const r = results[i];
        if (!r || !r.ok) {
          return { coin, rank: i + 1, hours: [], current: [], fetchedAt: 0, incomplete: true, error: r?.ok === false ? r.error : "sem dados" };
        }
        const last = r.value.hours[r.value.hours.length - 1] ?? [];
        const incomplete = analyzeWindow(last, hourStarts[hourStarts.length - 1]!, HOUR_MS, bandPct).complete === false;
        return { coin, rank: i + 1, ...r.value, incomplete, error: null };
      });
      setLoaded({ hourStarts, currentHourStart, coins });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [quote, minVol, topN, usdtBrl, period, bandPct]);

  const cancel = () => abortRef.current?.abort();
  useEffect(() => () => abortRef.current?.abort(), []);

  const costFor = useCallback(
    (symbol: string): CostOptions => {
      const c = loaded?.coins.find((x) => x.coin.symbol === symbol);
      const s = suggestionForTier(tierFromRank(c?.rank ?? 100));
      return { fee: s.fee_pct * 2, spread: s.spread_pct };
    },
    [loaded],
  );

  const backtest: BacktestResult | null = useMemo(() => {
    if (!loaded) return null;
    const coins = loaded.coins.filter((c) => !c.error).map((c) => ({ symbol: c.coin.symbol, hours: c.hours }));
    return runBacktest(coins, loaded.hourStarts, bandPct, costFor);
  }, [loaded, bandPct, costFor]);

  const ranking: RankRow[] = useMemo(() => {
    if (!loaded) return [];
    const rows: RankRow[] = [];
    const traumaMap = readTrauma();
    for (const c of loaded.coins) {
      if (c.error) continue;
      const from = c.fetchedAt - HOUR_MS;
      const prev = c.hours[c.hours.length - 1] ?? [];
      const window = [...prev, ...c.current].filter((k) => k.time >= from);
      const analysis = analyzeWindow(window, from, HOUR_MS, bandPct);
      const price = livePrices.get(c.coin.symbol) ?? analysis.lastClose;
      const baseBlocks = price != null ? liveBlocks({ analysis, candles: window, fetchedAt: c.fetchedAt, price, minRep }) : (["dados-velhos"] as LiveBlock[]);
      const tr = applyTrauma(traumaMap, { symbol: c.coin.symbol, candles: window, now: c.fetchedAt, coverage: analysis.coverage, blocks: baseBlocks });
      const blocks = tr.blocks;
      const pc = backtest?.perCoin.find((p) => p.symbol === c.coin.symbol);
      rows.push({
        symbol: c.coin.symbol,
        quote: c.coin.quote,
        analysis,
        window,
        price,
        distancePct: price && analysis.top ? ((analysis.top.center - price) / price) * 100 : null,
        blocks,
        trauma: traumaText(tr.state),
        hist: pc ? { chosen: pc.chosenCount, chosenWins: pc.chosenWins, iso: pc.isolatedCount, isoWins: pc.isolatedWins } : null,
        series: c.hours.map((h, i) => {
          const a = analyzeWindow(h, loaded.hourStarts[i]!, HOUR_MS, bandPct);
          return { h: hhmm(loaded.hourStarts[i]!), v: a.complete ? a.index : null };
        }),
      });
    }
    writeTrauma(traumaMap);
    return rows.sort(
      (a, b) =>
        Number(a.blocks.includes("cobertura")) - Number(b.blocks.includes("cobertura")) ||
        b.analysis.index - a.analysis.index ||
        (b.analysis.top?.seconds ?? 0) - (a.analysis.top?.seconds ?? 0),
    );
  }, [loaded, bandPct, livePrices, minRep, backtest]);

  // Geração da aposta: refaz a hora corrente e escolhe a primeira moeda liberada.
  const [pendingGenerate, setPendingGenerate] = useState(false);
  const [lastSkip, setLastSkip] = useState<string[]>([]);
  const generate = async () => {
    if (!(bankroll.stake > 0)) {
      toast.error("Informe o valor por aposta em “Sua banca” na tela principal.");
      return;
    }
    await load();
    setPendingGenerate(true);
  };
  // Automático: gera uma aposta Supremo a cada 1 minuto (ligado por padrão).
  const [autoOn, setAutoOn] = useState(true);
  const [autoNext, setAutoNext] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const nextRef = useRef<number | null>(null);
  const generateRef = useRef(generate);
  generateRef.current = generate;
  const autoCtx = useRef({ busy, stake: bankroll.stake });
  autoCtx.current = { busy, stake: bankroll.stake };
  useEffect(() => {
    if (!autoOn) {
      nextRef.current = null;
      setAutoNext(null);
      return;
    }
    nextRef.current = Date.now() + 60_000;
    setAutoNext(nextRef.current);
    const id = setInterval(() => {
      const now = Date.now();
      setNowTick(now);
      if (nextRef.current != null && now >= nextRef.current) {
        nextRef.current = now + 60_000;
        setAutoNext(nextRef.current);
        if (!autoCtx.current.busy && autoCtx.current.stake > 0) void generateRef.current();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [autoOn]);
  const autoCountdown =
    autoNext == null
      ? null
      : (() => {
          const s = Math.max(0, Math.ceil((autoNext - nowTick) / 1000));
          return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
        })();

  useEffect(() => {
    if (!pendingGenerate || busy || !loaded) return;
    setPendingGenerate(false);
    void (async () => {
    const exposure = readExposure();
    const combo = readActiveCombo();
    const label = comboLabel(combo.targetPct, combo.stopPct, combo.mode);
    // Ordena por pontuação histórica (taxa de alvo), com índice e segundos no ímã como desempate.
    const scored = await scoreRows(ranking, combo, Date.now());
    const { chosen, coins } = selectCoin(scored, (s) => exposureBlock(supremo.bets, s, label, exposure, Date.now()));
    const skipped = coins
      .filter((c) => c.symbol !== chosen?.symbol && (c.blocks.length > 0 || c.exposure || c.price == null))
      .map((c) => `${c.symbol}: ${[...c.blocks.map((b) => LIVE_BLOCK_LABEL[b]), ...(c.exposure ? [c.exposure] : [])].join(", ") || "sem preço"}`);
    const cycleId = newId();
    if (!chosen) {
      appendAudit({ id: cycleId, at: Date.now(), chosen: null, note: "Página Supremo: nenhuma moeda liberada.", coins });
      setLastSkip(skipped);
      toast.error("Nenhuma moeda liberada agora — veja os motivos no ranking.");
      return;
    }
    const r = scored.find((x) => x.symbol === chosen.symbol)!;
    appendAudit({ id: cycleId, at: Date.now(), chosen: r.symbol, note: "Página Supremo", coins });
    const base = planBet(r.analysis, r.price!)!;
    const plan = r.plan ?? planCombo(base.target, combo.targetPct, combo.stopPct, combo.mode);
    supremo.placeBet({
      symbol: r.symbol,
      quote: r.quote,
      priceNow: r.price,
      triggerPrice: plan.trigger,
      target: plan.target,
      stop: plan.stop,
      hitRate: r.report?.principal.taxaAcerto ?? 0,
      sampleSize: r.analysis.index,
      supremoMeta: r.report
        ? { score: r.report.pontuacao, stars: r.report.estrelas, hitRate: r.report.principal.taxaAcerto, cycles: r.cycles ?? 0 }
        : undefined,
      stake: bankroll.stake,
      leverage: bankroll.leverage,
      stakeCurrency: bankroll.currency,
      displayCurrency: bankroll.currency,
      fxAtCreate: convertMoney(1, r.quote, bankroll.currency, usdtBrl) ?? undefined,
      guard: (current: { status: string; symbol: string; combo?: string }[]) =>
        exposureBlock(current as never, r.symbol, label, readExposure(), Date.now()),
      combo: label,
      onBlocked: (why: string) => toast.error(`Aposta não registrada: ${why}.`),
    } as never);
    playNotificationSound("confirmacao");
    toast.success(`Aposta Supremo registrada em ${r.symbol} (índice ${r.analysis.index}).`);
    setLastSkip(skipped);
    })();
  }, [pendingGenerate, busy, loaded, ranking, supremo, bankroll, usdtBrl]);

  // Comparação com a regra atual do app (motor baseline) nas mesmas velas.
  const [current, setCurrent] = useState<{ metrics: Metrics; busy: boolean; done: number } | null>(null);
  const runCurrentRule = async () => {
    if (!loaded) return;
    const coins = loaded.coins.filter((c) => !c.error);
    const trades: ResolvedTrade[] = [];
    setCurrent({ metrics: computeMetrics([]), busy: true, done: 0 });
    for (let i = 0; i < coins.length; i++) {
      await new Promise((r) => setTimeout(r, 0));
      const c = coins[i]!;
      const cost = costFor(c.coin.symbol);
      const res = replayCandles(c.coin.symbol, c.hours.flat(), { feePct: cost.fee, spread: cost.spread ?? null, assumeBookFromRegime: true } as never);
      trades.push(...res.trades.filter((t) => t.status === "win" || t.status === "loss" || t.status === "ambiguo"));
      setCurrent({ metrics: computeMetrics(trades), busy: true, done: i + 1 });
    }
    setCurrent({ metrics: computeMetrics(trades), busy: false, done: coins.length });
  };

  const downloadCsv = () => {
    if (!backtest) return;
    const blob = new Blob([rowsToCsv(backtest.chosen)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "supremo-backtest.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const fmtBetPrice = useCallback(
    (v: number | null) => (v == null ? "—" : formatQuotePrice(convertMoney(v, quote, bankroll.currency, usdtBrl), bankroll.currency)),
    [quote, bankroll.currency, usdtBrl],
  );

  const detail = ranking.find((r) => r.symbol === (selected ?? ranking[0]?.symbol)) ?? null;
  const incompleteCoins = loaded?.coins.filter((c) => c.error || c.incomplete) ?? [];

  const { ui, setTab } = useUiLayout();
  const supTab = ui.tabs["supremo"] ?? "geral";
  return (
    <main className="mx-auto max-w-6xl space-y-5 px-3 py-6 md:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-primary">Validar Aposta Supremo</h1>
          <p className="text-sm text-muted-foreground">
            Simulador histórico por hora: a moeda cuja faixa de preço mais se repetiu gera a aposta. Dados reais de 1 s da Binance.
          </p>
        </div>
      </header>

      {/* Controles */}
      <section className={cn(card, "flex flex-wrap items-end gap-3")}>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          cotação
          <select className={sel} value={topN === -1 ? "USDT" : quote} disabled={topN === -1} onChange={(e) => setQuote(e.target.value as "USDT" | "BRL")}>
            <option value="USDT">USDT</option>
            <option value="BRL">BRL</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          moedas
          <select className={sel} value={topN ?? 0} onChange={(e) => { const v = Number(e.target.value) || null; setTopN(v); if (v === -1) setQuote("USDT"); }}>
            <option value={-1}>Mesma lista do painel (10)</option>
            {[20, 40, 60, 100].map((n) => (
              <option key={n} value={n}>Top {n} por volume</option>
            ))}
            <option value={0}>Todas</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          volume 24h mínimo (US$)
          <input type="number" className={cn(sel, "w-32")} value={minVol} min={0} step={100000} onChange={(e) => setMinVol(Number(e.target.value) || 0)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          período
          <select className={sel} value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
            {[6, 12, 24].map((h) => (
              <option key={h} value={h}>{h} h</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          largura da faixa (%)
          <input type="number" className={cn(sel, "w-20")} value={+(bandPct * 100).toFixed(3)} min={0.05} max={2} step={0.05} onChange={(e) => setBandPct(Math.max(0.0005, Number(e.target.value) / 100))} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          repetições mínimas
          <input type="number" className={cn(sel, "w-16")} value={minRep} min={1} onChange={(e) => setMinRep(Math.max(1, Number(e.target.value) || 1))} />
        </label>
        <button type="button" onClick={() => void load()} disabled={busy} className="rounded-md border border-primary px-3 py-2 text-sm font-medium text-primary disabled:opacity-50">
          {busy ? "carregando…" : loaded ? "Atualizar" : "Carregar dados"}
        </button>
        <button type="button" onClick={() => void generate()} disabled={busy} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          Gerar aposta Supremo
        </button>
        {busy && (
          <button type="button" onClick={cancel} className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
            cancelar
          </button>
        )}
        {progress && (
          <div className="w-full">
            <div className="mb-1 text-xs text-muted-foreground">
              moedas processadas: {progress.done}/{progress.total} (horas fechadas vêm do cache)
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          </div>
        )}
      </section>

      {error && <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</p>}

      {!loaded && !busy && !error && (
        <p className={cn(card, "text-sm text-muted-foreground")}>
          Clique em “Carregar dados” para baixar as velas de 1 s das moedas do universo escolhido.
        </p>
      )}

      <Tabs value={supTab} onValueChange={(v) => setTab("supremo", v)} className="space-y-4">
        <div className="overflow-x-auto">
          <TabsList className="h-auto w-max gap-1 bg-surface p-1">
            {SUP_TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="min-h-10 px-3 font-display text-sm font-semibold uppercase tracking-wider data-[state=active]:bg-gold data-[state=active]:text-primary-foreground">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="geral" className="space-y-5">
      <BestBetPanel
        rows={best.scored}
        nextPick={best.nextPick}
        scannedAt={best.scannedAt}
        fmtPrice={fmtBetPrice}
        onBet={best.betOn}
        onRefresh={best.refresh}
                regime={best.regime}
      />

      <SupremoEconomia
        bets={supremo.bets}
        symbols={best.scored.map((r) => r.symbol)}
        fx={{ rate: usdtBrl, at: fxQuery.dataUpdatedAt || null }}
      />

        </TabsContent>
        <TabsContent value="moedas" className="space-y-5">
          {loaded ? (
            <>
          {/* Ranking ao vivo */}
          <section className={card}>
            <h2 className="mb-1 font-semibold text-primary">Ranking ao vivo — últimos 60 min</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Índice = visitas separadas à faixa mais repetida. Clique numa moeda para ver o detalhe.
              {incompleteCoins.length > 0 && ` ${incompleteCoins.length} moeda(s) com dados incompletos ficam fora.`}
            </p>
            {ranking.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem moedas com dados.</p>
            ) : (
              <div className="max-h-[480px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card text-muted-foreground">
                    <tr className="text-left">
                      <th className="p-1">#</th>
                      <th className="p-1">moeda</th>
                      <th className="p-1">índice</th>
                      <th className="p-1">preço-alvo</th>
                      <th className="p-1">faixa</th>
                      <th className="p-1">dist.</th>
                      <th className="p-1">acerto hist.</th>
                      <th className="p-1">índice por hora</th>
                      <th className="p-1">situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((r, i) => (
                      <tr
                        key={r.symbol}
                        onClick={() => setSelected(r.symbol)}
                        className={cn("cursor-pointer border-t border-border/40 hover:bg-accent/40", detail?.symbol === r.symbol && "bg-accent/60")}
                      >
                        <td className="p-1">{i + 1}</td>
                        <td className="p-1 font-medium">{r.symbol}</td>
                        <td className="p-1 text-primary">{r.analysis.index}</td>
                        <td className="p-1">{r.analysis.top ? formatPrice(r.analysis.top.center, r.quote) : "—"}</td>
                        <td className="p-1 text-muted-foreground">
                          {r.analysis.top ? `${formatPrice(r.analysis.top.low, "")}–${formatPrice(r.analysis.top.high, "")}` : "—"}
                        </td>
                        <td className="p-1">{r.distancePct != null ? fmtPct(r.distancePct / 100) : "—"}</td>
                        <td className="p-1">
                          {r.hist && r.hist.iso > 0 ? `${((r.hist.isoWins / r.hist.iso) * 100).toFixed(0)}% (${r.hist.iso})` : "—"}
                        </td>
                        <td className="p-1">
                          <div className="h-6 w-24">
                            <ResponsiveContainer>
                              <LineChart data={r.series}>
                                <Line dataKey="v" stroke="var(--primary)" dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls={false} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </td>
                        <td className="p-1">
                          {r.blocks.length === 0 ? (
                            <span className="text-primary">liberada</span>
                          ) : (
                            <span className="text-muted-foreground">
                              {r.blocks.map((b) => LIVE_BLOCK_LABEL[b]).join("; ")}
                              {r.trauma && <span className="block text-destructive">{r.trauma}</span>}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {lastSkip.length > 0 && (
              <details className="mt-2 text-xs text-muted-foreground">
                <summary>moedas puladas na última geração ({lastSkip.length})</summary>
                <ul className="mt-1 list-disc pl-5">{lastSkip.slice(0, 20).map((s) => <li key={s}>{s}</li>)}</ul>
              </details>
            )}
            {incompleteCoins.length > 0 && (
              <details className="mt-2 text-xs text-muted-foreground">
                <summary>dados incompletos ({incompleteCoins.length})</summary>
                <ul className="mt-1 list-disc pl-5">
                  {incompleteCoins.map((c) => <li key={c.coin.symbol}>{c.coin.symbol}: {c.error ?? "cobertura abaixo de 60% na última hora"}</li>)}
                </ul>
              </details>
            )}
          </section>

            </>
          ) : (<p className={cn(card, "text-sm text-muted-foreground")}>Clique em “Carregar dados” acima para ver esta aba.</p>)}
        </TabsContent>
        <TabsContent value="apostas" className="space-y-5">
          <BetTracker
            title="Validar aposta Supremo"
            description="A moeda com maior índice de repetição dos últimos 60 min gera a aposta. Alvo = centro da faixa mais repetida; gatilho = alvo ÷ 1,0055; limite de perda = gatilho ÷ 1,0055."
            hidePlace
            bets={supremo.bets}
            stars={supremo.stars}
            losses={supremo.losses}
            livePrice={null}
            livePrices={livePrices}
            currency={bankroll.currency}
            usdtBrl={usdtBrl}
            fmtPrice={fmtBetPrice}
            canPlace={false}
            blockedReason={bankroll.stake > 0 ? null : "Informe o valor por aposta em “Sua banca” na tela principal."}
            autoLabel="Gerar aposta automaticamente a cada 1 minuto"
            autoOn={autoOn}
            onToggleAuto={setAutoOn}
            autoCountdown={autoCountdown}
            onPlace={() => {}}
            onClear={supremo.clearHistory}
            onRemove={supremo.removeBet}
          />

        </TabsContent>
        <TabsContent value="placar" className="space-y-5">
      <SupremoRanking
        bets={supremo.bets}
        scored={best.scored}
        nextPick={best.nextPick}
        scannedAt={best.scannedAt}
        livePrices={livePrices}
        fx={{ rate: usdtBrl, at: fxQuery.dataUpdatedAt || null }}
      />

        </TabsContent>
        <TabsContent value="hora" className="space-y-5">
          {loaded ? (
            <>
          {/* Detalhe */}
          <section className={card}>
            <h2 className="mb-2 font-semibold text-primary">Detalhe da moeda {detail ? `— ${detail.symbol}` : ""}</h2>
            {!detail || detail.window.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem dados para esta moeda.</p>
            ) : (
              <CoinDetail row={detail} />
            )}
          </section>
            </>
          ) : (<p className={cn(card, "text-sm text-muted-foreground")}>Clique em “Carregar dados” acima para ver esta aba.</p>)}
        </TabsContent>
        <TabsContent value="backtest" className="space-y-5">
          {loaded ? (
            <>
          {/* Backtest */}
          {backtest && (
            <section className={card}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold text-primary">Backtest — “maior índice da última hora”</h2>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void runCurrentRule()} disabled={current?.busy} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground disabled:opacity-50">
                    {current?.busy ? `regra atual… ${current.done}` : "comparar com a regra atual"}
                  </button>
                  <button type="button" onClick={downloadCsv} disabled={backtest.chosen.length === 0} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground disabled:opacity-50">
                    exportar CSV
                  </button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <SummaryCard title="Supremo (moeda escolhida)" rows={backtest.chosen} m={backtest.chosenMetrics} />
                <SummaryCard title="Todas as moedas, toda hora (sem escolher)" rows={backtest.isolated} m={backtest.isolatedMetrics} />
                <div className="rounded-md border border-border/60 p-3 text-xs">
                  <div className="mb-1 font-medium">Regra atual do app (mesmas velas)</div>
                  {current ? <MetricsBlock m={current.metrics} /> : <p className="text-muted-foreground">Clique em “comparar com a regra atual” (pode levar alguns segundos).</p>}
                </div>
              </div>

              {backtest.chosen.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">Sem apostas simuladas no período (aumente o período ou reduza a largura da faixa).</p>
              ) : (
                <div className="mt-3 max-h-72 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card text-muted-foreground">
                      <tr className="text-left">
                        <th className="p-1">hora</th><th className="p-1">moeda</th><th className="p-1">índice</th><th className="p-1">gatilho</th><th className="p-1">alvo</th><th className="p-1">stop</th><th className="p-1">resultado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backtest.chosen.map((r) => (
                        <tr key={`${r.symbol}-${r.hourStart}`} className="border-t border-border/40">
                          <td className="p-1">{hhmm(r.hourStart)}</td>
                          <td className="p-1">{r.symbol}</td>
                          <td className="p-1">{r.index}</td>
                          <td className="p-1">{formatPrice(r.trigger, "")}</td>
                          <td className="p-1">{formatPrice(r.target, "")}</td>
                          <td className="p-1">{formatPrice(r.stop, "")}</td>
                          <td className={cn("p-1", r.outcome === "win" && "text-primary", r.outcome === "loss" && "text-destructive")}>
                            {OUTCOME_LABEL[r.outcome]}{r.ambiguous ? " (ambígua)" : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h3 className="mb-1 mt-4 text-sm font-medium">Acerto histórico por moeda</h3>
              <div className="max-h-56 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="text-left"><th className="p-1">moeda</th><th className="p-1">quando escolhida</th><th className="p-1">simulada isolada</th></tr>
                  </thead>
                  <tbody>
                    {backtest.perCoin.map((p) => (
                      <tr key={p.symbol} className="border-t border-border/40">
                        <td className="p-1">{p.symbol}</td>
                        <td className="p-1">{p.chosenCount ? `${p.chosenWins}/${p.chosenCount} (${((p.chosenWins / p.chosenCount) * 100).toFixed(0)}%)` : "—"}</td>
                        <td className="p-1">{p.isolatedCount ? `${p.isolatedWins}/${p.isolatedCount} (${((p.isolatedWins / p.isolatedCount) * 100).toFixed(0)}%)` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

            </>
          ) : (<p className={cn(card, "text-sm text-muted-foreground")}>Clique em “Carregar dados” acima para ver esta aba.</p>)}
        </TabsContent>
      </Tabs>

    </main>
  );
}

const OUTCOME_LABEL = { win: "vitória", loss: "derrota", "nao-executada": "não executada", "sem-desfecho": "sem desfecho" } as const;

function SummaryCard({ title, rows, m }: { title: string; rows: BacktestResult["chosen"]; m: Metrics }) {
  const notExec = rows.filter((r) => r.outcome === "nao-executada").length;
  const noEnd = rows.filter((r) => r.outcome === "sem-desfecho").length;
  return (
    <div className="rounded-md border border-border/60 p-3 text-xs">
      <div className="mb-1 font-medium">{title}</div>
      <Row label="apostas geradas" value={String(rows.length)} />
      <Row label="não executadas" value={String(notExec)} />
      <Row label="abertas sem desfecho na hora" value={String(noEnd)} />
      <MetricsBlock m={m} />
    </div>
  );
}

function MetricsBlock({ m }: { m: Metrics }) {
  return (
    <>
      <Row label="executadas (com desfecho)" value={String(m.sample)} />
      <Row label="vitórias / derrotas" value={`${m.wins} / ${m.losses}`} />
      <Row label="taxa de acerto" value={fmtPct(m.hitRate)} />
      <Row label="intervalo 95% (Wilson)" value={m.hitRateCI ? `${fmtPct(m.hitRateCI.low, 1)} – ${fmtPct(m.hitRateCI.high, 1)}` : "—"} />
      <Row label="expectativa líquida/aposta" value={fmtPct(m.expectancy, 3)} />
      <Row label="acerto p/ empatar" value={fmtPct(m.breakevenHitRate)} />
      <div className={cn("mt-1 text-[0.7rem]", m.sample >= 100 ? "text-primary" : "text-muted-foreground")}>
        {sampleLabel(m.sample)} · {fmtNum(m.sample, 0)} apostas
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function CoinDetail({ row }: { row: RankRow }) {
  const a = row.analysis;
  const bars = useMemo(
    () => [...a.bands].sort((x, y) => x.center - y.center).map((b) => ({ p: formatPrice(b.center, ""), s: b.seconds, top: b.index === a.top?.index })),
    [a],
  );
  const line = useMemo(() => {
    const step = Math.max(1, Math.floor(row.window.length / 360));
    return row.window.filter((_, i) => i % step === 0).map((c) => ({ t: c.time, p: c.close }));
  }, [row.window]);
  const visits = a.top?.visitTimes ?? [];
  const nearest = (t: number) => line.reduce((best, x) => (Math.abs(x.t - t) < Math.abs(best.t - t) ? x : best), line[0]!);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <div className="mb-1 text-xs text-muted-foreground">Histograma da hora (segundos por faixa de {(0.25).toFixed(2)}% configurável)</div>
        <div className="h-56">
          <ResponsiveContainer>
            <BarChart data={bars}>
              <XAxis dataKey="p" hide />
              <YAxis width={40} tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }} />
              <Bar dataKey="s" name="segundos" fill="var(--primary)" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs text-muted-foreground">Preço com a faixa mais repetida e as {visits.length} visitas</div>
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={line}>
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={hhmm} tick={{ fontSize: 10 }} />
              <YAxis domain={["auto", "auto"]} width={60} tick={{ fontSize: 10 }} tickFormatter={(v: number) => formatPrice(v, "")} />
              <Tooltip labelFormatter={(t) => hhmm(Number(t))} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }} />
              {a.top && <ReferenceArea y1={a.top.low} y2={a.top.high} fill="var(--primary)" fillOpacity={0.18} />}
              <Line dataKey="p" stroke="var(--foreground)" dot={false} strokeWidth={1} isAnimationActive={false} />
              {line.length > 0 && visits.map((t) => <ReferenceDot key={t} x={nearest(t).t} y={nearest(t).p} r={3} fill="var(--primary)" stroke="none" />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
