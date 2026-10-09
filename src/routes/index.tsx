import { useCloudUser } from "@/hooks/useCloudUser";
import { AUTO_ON_KEY, CLOUD_PULL_EVENT, readAutoOn } from "@/lib/cloud-keys";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { toast } from "sonner";

import { CoinSelector } from "@/components/CoinSelector";
import { BankrollPanel } from "@/components/BankrollPanel";
import { BetTracker } from "@/components/BetTracker";
import { LivePriceTicker } from "@/components/LivePriceTicker";
import { EntryTriggerDisplay } from "@/components/EntryTriggerDisplay";
import { PriceChart, type ChartPoint } from "@/components/PriceChart";
import { Section } from "@/components/Section";
import { Bell, BellOff } from "lucide-react";
import { useUiLayout } from "@/hooks/useUiLayout";
import { publishShellStatus } from "@/hooks/useShellStatus";
import { bookStats } from "@/lib/supremo-live";
import { REGIME_LABEL } from "@/lib/market-regime";
import { useLivePrice } from "@/hooks/useLivePrice";
import { useAllTickerPrices, type PriceMap } from "@/hooks/useAllTickerPrices";
import { useBets, NET_WIN_PCT, betPnl } from "@/hooks/useBets";
import { useBankroll } from "@/hooks/useBankroll";
import { fetchPairs, fetchUsdtBrl, PAIRS } from "@/lib/binance";
import { convertMoney, formatMoney, formatQuotePrice } from "@/lib/money";
import { runScalpEngine, type EngineMode } from "@/lib/scalp";
import { FilterPanel } from "@/components/FilterPanel";
import { PairRankingCard } from "@/components/PairRankingCard";
import { DecisionRankingTable, decisionRow } from "@/components/DecisionRankingTable";
import { usePairRanking } from "@/hooks/usePairRanking";
import { useSupremoAuto } from "@/hooks/useSupremoAuto";
import { SupremoLab } from "@/components/SupremoLab";
import { SupremoInsights } from "@/components/SupremoInsights";
import { BestBetPanel } from "@/components/BestBetPanel";
import { SupremoRanking } from "@/components/SupremoRanking";
import { SupremoEconomia } from "@/components/SupremoEconomia";
import { cn } from "@/lib/utils";
import { playNotificationSound } from "@/lib/notification-sounds";
import { useBetNotifications } from "@/hooks/useBetNotifications";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ypx Bet — Gatilho de entrada ao vivo" },
      {
        name: "description",
        content:
          "Gatilho de entrada calculado tick a tick em 180 segundos, com alta bruta de +0,55% para cobrir as taxas e sobrar +0,35% líquido.",
      },
      { property: "og:title", content: "Ypx Bet — Gatilho de entrada ao vivo" },
      {
        property: "og:description",
        content:
          "Preço ao vivo da Binance, gatilho no preço mais repetido da janela (micro-suporte) e proteção contra quedas violentas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [symbol, setSymbol] = useState<string>(PAIRS[0].symbol);
  const { bankroll, setInitial, setStake, setLeveraged, setCurrency } = useBankroll();

  const symbolsQuery = useQuery({
    queryKey: ["pairs"],
    queryFn: fetchPairs,
    refetchInterval: 15 * 1000,
    staleTime: 10 * 1000,
  });

  const fxQuery = useQuery({
    queryKey: ["usdtbrl"],
    queryFn: fetchUsdtBrl,
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  });
  const usdtBrl = fxQuery.data ?? null;

  const { price: livePrice, ticks, status, book } = useLivePrice(symbol);
  // Painéis do usuário: só o par em exibição. Ranking entre pares precisa de todos.
  const tickerPrices = useAllTickerPrices();

  // Fonte única de preço: o par em exibição usa exatamente o mesmo número
  // mostrado em "Último preço", e os outros pares vêm do fluxo de todos os
  // pares. Qualquer painel (tabela de apostas, seletor, ranking) lê daqui.
  const livePrices = useMemo(() => {
    const merged: PriceMap = new Map(tickerPrices);
    // Preserva o horário de cada leitura (sem isso as pendentes de outras moedas pareciam sem preço).
    merged.times = new Map(tickerPrices.times ?? []);
    if (livePrice != null) {
      merged.set(symbol, livePrice);
      merged.times.set(symbol, Date.now());
    }
    return merged;
  }, [tickerPrices, symbol, livePrice]);

  const selectorSymbols = useMemo(() => {
    const base =
      symbolsQuery.data ??
      PAIRS.map((p) => ({ ...p, price: NaN, changePct: NaN, quoteVolume: NaN }));
    return base.map((p) => {
      const live = livePrices.get(p.symbol);
      return live != null ? { ...p, price: live } : p;
    });
  }, [symbolsQuery.data, livePrices]);

  const quote = useMemo(() => {
    const found = symbolsQuery.data?.find((p) => p.symbol === symbol);
    if (found) return found.quote;
    return symbol.endsWith("BRL") ? "BRL" : symbol.endsWith("USDT") ? "USDT" : "";
  }, [symbol, symbolsQuery.data]);

  const fmtPrice = useCallback(
    (v: number | null) => {
      if (v == null || !quote) return "—";
      const converted = convertMoney(v, quote, bankroll.currency, usdtBrl);
      return formatQuotePrice(converted, bankroll.currency);
    },
    [quote, bankroll.currency, usdtBrl],
  );

  // Relógio de 1 s: recalcula o gatilho mesmo quando não chega tick novo
  // (janela de 180 s deslizando, velocidade de 5 s, desvio-padrão).
  const [engineClock, setEngineClock] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setEngineClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const [engineMode, setEngineMode] = useState<EngineMode>("baseline");
  // Ranking informativo entre TODOS os pares listados (não é sinal novo).
  const rankingPairs = useMemo(
    () => selectorSymbols.map((p) => ({ symbol: p.symbol, base: p.base, quote: p.quote })),
    [selectorSymbols],
  );
  const pairRanking = usePairRanking(
    rankingPairs,
    undefined,
    engineMode,
    undefined,
  );
  const engine = useMemo(
    () =>
      runScalpEngine(ticks, engineClock, {
        mode: engineMode,
        context: {
          bestBid: book?.bid ?? null,
          bestAsk: book?.ask ?? null,
          bidQty: book?.bidQty ?? null,
          askQty: book?.askQty ?? null,
          stakeQuote: bankroll.stake > 0 ? bankroll.stake * bankroll.leverage : null,
          exchangeDown: status === "offline",
        },
      }),
    [ticks, engineClock, engineMode, book, bankroll.stake, bankroll.leverage, status],
  );
  const entryPrice = engine.entryTrigger;
  // Última leitura REAL (ignora segundos preenchidos com o último preço).
  const lastTickAt = useMemo(() => {
    for (let i = ticks.length - 1; i >= 0; i--) {
      const t = ticks[i]!;
      if (t.source !== "hold") return t.time;
    }
    return null;
  }, [ticks]);

  const chartData: ChartPoint[] = useMemo(
    () => ticks.map((t) => ({ time: t.time, price: t.price })),
    [ticks],
  );

  const {
    bets,
    stars,
    losses,
    realizedPnl,
    openPnl,
    placeBet,
    removeBet,
    clearHistory,
    justWon,
    clearJustWon,
    justArmed,
    clearJustArmed,
    justLost,
    clearJustLost,
  } = useBets(symbol, livePrice, quote, livePrices);

  // ===== Validar aposta 2 (automática): a cada minuto, o par mais estável =====
  const auto2 = useBets(symbol, livePrice, quote, livePrices, "scalp-terminal-bets-auto2-v1");
  const [auto2On, setAuto2On] = useState(true);
  const [auto2Next, setAuto2Next] = useState<number | null>(null);
  const priceHist = useRef(new Map<string, { t: number; p: number }[]>());
  const livePricesRef = useRef(livePrices);
  livePricesRef.current = livePrices;
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      for (const [s, p] of livePricesRef.current) {
        if (!isFinite(p) || p <= 0) continue;
        const arr = priceHist.current.get(s) ?? [];
        arr.push({ t, p });
        while (arr.length && arr[0]!.t < t - 60_000) arr.shift();
        priceHist.current.set(s, arr);
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);
  const auto2Ctx = useRef({ ranked: pairRanking.ranked, engines: pairRanking.engines, bets: auto2.bets, bankroll, usdtBrl, place: auto2.placeBet });
  auto2Ctx.current = { ranked: pairRanking.ranked, engines: pairRanking.engines, bets: auto2.bets, bankroll, usdtBrl, place: auto2.placeBet };
  useEffect(() => {
    if (!auto2On) {
      setAuto2Next(null);
      return;
    }
    setAuto2Next(Date.now() + 60_000);
    const id = setInterval(() => {
      setAuto2Next(Date.now() + 60_000);
      const { ranked, engines, bets: openBets, bankroll: br, usdtBrl: fx, place } = auto2Ctx.current;
      if (br.stake <= 0) return;
      // Pares que já têm aposta aguardando ou valendo não recebem outra.
      const busy = new Set(
        openBets.filter((b) => b.status === "pending" || b.status === "open").map((b) => b.symbol),
      );
      let best: {
        r: (typeof ranked)[number];
        vol: number;
        px: number;
        trigger: number;
        target: number | null;
        stop: number | null;
      } | null = null;
      for (const r of ranked) {
        if (r.state === "bloqueado" || busy.has(r.symbol)) continue;
        // Gatilho real do motor (micro-suporte abaixo do preço), nunca o preço atual.
        const eng = engines.get(r.symbol);
        const trigger = eng?.entryTrigger ?? null;
        const arr = priceHist.current.get(r.symbol);
        if (!arr || arr.length < 30) continue;
        const ps = arr.map((x) => x.p);
        const px = ps[ps.length - 1]!;
        // O ranking escolhe só a moeda. Gatilho, alvo e limite de perda são
        // calculados na hora com os mesmos índices do "Validar aposta 1"
        // (ímã da janela de 180 s, ±0,55%) — filtros não bloqueiam a escolha.
        if (!eng || trigger == null || !(trigger < px)) continue;
        const mean = ps.reduce((a, b) => a + b, 0) / ps.length;
        const vol = (Math.max(...ps) - Math.min(...ps)) / mean;
        if (!best || vol < best.vol)
          best = { r, vol, px, trigger, target: eng.grossTarget, stop: eng.stop };
      }
      if (!best) return;
      place({
        triggerPrice: best.trigger,
        target: best.target ?? undefined,
        stop: best.stop ?? undefined,
        hitRate: 0.9,
        sampleSize: arr60(best.r.symbol),
        stake: br.stake,
        leverage: br.leverage,
        stakeCurrency: br.currency,
        displayCurrency: br.currency,
        fxAtCreate: convertMoney(1, best.r.quote, br.currency, fx) ?? undefined,
        symbol: best.r.symbol,
        quote: best.r.quote,
        priceNow: best.px,
      });
      playNotificationSound("confirmacao");
      toast(`Aposta automática 2: ${best.r.base}/${best.r.quote}`, {
        description: `Par mais estável no último minuto (oscilação ${(best.vol * 100).toFixed(3).replace(".", ",")}%).`,
      });
    }, 60_000);
    return () => clearInterval(id);
  }, [auto2On]);
  function arr60(s: string) {
    return priceHist.current.get(s)?.length ?? 0;
  }

  useEffect(() => {
    if (auto2.justWon) { playNotificationSound("sucesso"); toast.success("Estrelinha na validação automática 2!"); auto2.clearJustWon(); }
  }, [auto2.justWon, auto2.clearJustWon]);
  useEffect(() => {
    if (auto2.justLost) { playNotificationSound("erro"); toast.error("Erro na validação automática 2."); auto2.clearJustLost(); }
  }, [auto2.justLost, auto2.clearJustLost]);
  useEffect(() => {
    if (auto2.justArmed) auto2.clearJustArmed();
  }, [auto2.justArmed, auto2.clearJustArmed]);

  // ===== Validar aposta 3 (Ranking): a cada minuto, a moeda com maior nota média
  // no último minuto em "Ranking de decisão" =====
  const supremoBets = useBets(null, null, quote, livePrices, "scalp-terminal-bets-supremo-v1", true);
  const [supremoAutoOn, setSupremoAutoOnRaw] = useState(true);
  const cloudUser = useCloudUser();
  useEffect(() => {
    setSupremoAutoOnRaw(readAutoOn());
    const onPull = (e: Event) => { if ((e as CustomEvent<string>).detail === AUTO_ON_KEY) setSupremoAutoOnRaw(readAutoOn()); };
    window.addEventListener(CLOUD_PULL_EVENT, onPull);
    return () => window.removeEventListener(CLOUD_PULL_EVENT, onPull);
  }, []);
  const setSupremoAutoOn = useCallback((v: boolean | ((p: boolean) => boolean)) => {
    setSupremoAutoOnRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      localStorage.setItem(AUTO_ON_KEY, String(next));
      return next;
    });
  }, []);
  const supremoAuto = useSupremoAuto({
    enabled: supremoAutoOn,
    serverRuns: cloudUser != null,
    placeBet: supremoBets.placeBet,
    bets: supremoBets.bets,
    bankroll,
    usdtBrl: usdtBrl ?? null,
    livePrices,
  });
  const auto3 = useBets(symbol, livePrice, quote, livePrices, "scalp-terminal-bets-auto3-v1");
  const [auto3On, setAuto3On] = useState(true);
  const [auto3Next, setAuto3Next] = useState<number | null>(null);
  const scoreHist = useRef(new Map<string, { t: number; c: number }[]>());
  const auto3Ctx = useRef({
    pairs: pairRanking.pairs,
    engines: pairRanking.decisionEngines,
    bets: auto3.bets,
    bankroll,
    usdtBrl,
    place: auto3.placeBet,
  });
  auto3Ctx.current = {
    pairs: pairRanking.pairs,
    engines: pairRanking.decisionEngines,
    bets: auto3.bets,
    bankroll,
    usdtBrl,
    place: auto3.placeBet,
  };
  // Amostra a nota de cada par a cada segundo (mesma nota da tabela).
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      const { pairs, engines } = auto3Ctx.current;
      for (const pair of pairs) {
        if (pair.quote !== "USDT") continue;
        const e = engines.get(pair.symbol);
        if (!e) continue;
        const row = decisionRow(pair, e, livePricesRef.current);
        const arr = scoreHist.current.get(pair.symbol) ?? [];
        arr.push({ t, c: row.confidence });
        while (arr.length && arr[0]!.t < t - 60_000) arr.shift();
        scoreHist.current.set(pair.symbol, arr);
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!auto3On) {
      setAuto3Next(null);
      return;
    }
    setAuto3Next(Date.now() + 60_000);
    const id = setInterval(() => {
      setAuto3Next(Date.now() + 60_000);
      const { pairs, engines, bets: list, bankroll: br, usdtBrl: fx, place } = auto3Ctx.current;
      if (br.stake <= 0) return;
      const busy = new Set(
        list.filter((b) => b.status === "pending" || b.status === "open").map((b) => b.symbol),
      );
      let best: { pair: (typeof pairs)[number]; avg: number; px: number; trigger: number; target: number | null; stop: number | null; n: number } | null = null;
      for (const pair of pairs) {
        if (pair.quote !== "USDT" || busy.has(pair.symbol)) continue;
        const e = engines.get(pair.symbol);
        const arr = scoreHist.current.get(pair.symbol);
        if (!e || !arr || arr.length < 30) continue;
        const row = decisionRow(pair, e, livePricesRef.current);
        // Gatilho real abaixo do preço. Filtros reprovados ("Evitar") não impedem:
        // a validação escolhe a maior nota média entre todas as moedas.
        if (row.trigger == null || row.price == null || !(row.trigger < row.price)) continue;
        const avg = arr.reduce((a, b) => a + b.c, 0) / arr.length;
        if (!best || avg > best.avg)
          best = { pair, avg, px: row.price, trigger: row.trigger, target: e.grossTarget, stop: e.stop, n: arr.length };
      }
      if (!best) return;
      place({
        triggerPrice: best.trigger,
        target: best.target ?? undefined,
        stop: best.stop ?? undefined,
        hitRate: 0.9,
        sampleSize: best.n,
        stake: br.stake,
        leverage: br.leverage,
        stakeCurrency: br.currency,
        displayCurrency: br.currency,
        fxAtCreate: convertMoney(1, best.pair.quote, br.currency, fx) ?? undefined,
        symbol: best.pair.symbol,
        quote: best.pair.quote,
        priceNow: best.px,
      });
      playNotificationSound("confirmacao");
      toast(`Aposta automática 3: ${best.pair.base}/${best.pair.quote}`, {
        description: `Maior nota média no Ranking de decisão no último minuto (${Math.round(best.avg)}%).`,
      });
    }, 60_000);
    return () => clearInterval(id);
  }, [auto3On]);
  useEffect(() => {
    if (auto3.justWon) { playNotificationSound("sucesso"); toast.success("Estrelinha na validação 3 (Ranking)!"); auto3.clearJustWon(); }
  }, [auto3.justWon, auto3.clearJustWon]);
  useEffect(() => {
    if (auto3.justLost) { playNotificationSound("erro"); toast.error("Erro na validação 3 (Ranking)."); auto3.clearJustLost(); }
  }, [auto3.justLost, auto3.clearJustLost]);
  useEffect(() => {
    if (auto3.justArmed) auto3.clearJustArmed();
  }, [auto3.justArmed, auto3.clearJustArmed]);

  // Borda da tela: verde quando o gatilho é atingido, vermelha no perigo.
  const [flash, setFlash] = useState<"none" | "green" | "red">("none");
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerFlash = useCallback((kind: "green" | "red") => {
    setFlash(kind);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash("none"), 2600);
  }, []);
  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  const wasDanger = useRef(false);
  useEffect(() => {
    if (engine.danger && !wasDanger.current) {
      triggerFlash("red");
      playNotificationSound("aviso");
      toast.warning("Atenção: queda muito rápida detectada.", {
        description: "As entradas estão pausadas até o mercado desacelerar.",
      });
    }
    wasDanger.current = engine.danger;
  }, [engine.danger, triggerFlash]);

  useEffect(() => {
    if (!justWon) return;
    playNotificationSound("sucesso");
    const ganho = bankroll.stake * bankroll.leverage * NET_WIN_PCT;
    toast.success("Estrelinha conquistada! +0,55% bruto (+0,35% líquido) antes do limite de perda.", {
      description:
        bankroll.stake > 0
          ? `Ganho estimado de ${formatMoney(ganho, bankroll.currency, { signed: true })}.`
          : "A previsão se confirmou em tempo real.",
    });
    clearJustWon();
  }, [justWon, clearJustWon, bankroll]);

  useEffect(() => {
    if (!justArmed) return;
    playNotificationSound("entrada");
    triggerFlash("green");
    toast("O preço de entrada foi atingido — posição aberta rumo ao preço-alvo.", {
      description:
        "Agora vale o que vier primeiro: +0,55% bruto (estrelinha, +0,35% líquido) ou −0,55% (limite de perda, −0,75% líquido).",
    });
    clearJustArmed();
  }, [justArmed, clearJustArmed, triggerFlash]);

  useEffect(() => {
    if (!justLost) return;
    playNotificationSound("erro");
    toast.error("Limite de perda atingido.", {
      description: "A posição foi encerrada com −0,75% líquido estimado.",
    });
    clearJustLost();
  }, [justLost, clearJustLost]);

  const missingStake = bankroll.stake <= 0;
  const canPlace = livePrice != null && engine.ready && !missingStake;
  const reasonText: Record<string, string> = {
    danger: "Queda violenta em andamento — o cálculo está invalidado até o mercado desacelerar.",
    "stale-data":
      "Leitura de preço atrasada — sem dado fresco o suficiente para considerar o gatilho válido.",
    "incomplete-data":
      "Janela incompleta (segundos sem leitura) — aguardando o fluxo de preços normalizar.",
    flat: "Este par está sem oscilação nos últimos 180 segundos — sem gatilho para apostar.",
    "below-entry":
      "O preço atual está abaixo do gatilho calculado — aguardando o mercado subir para valer a entrada na queda.",
    "no-cluster": "O preço está no fundo da janela — aguardando um novo suporte abaixo.",
    filtro: `Modo de agrupamento estável: ${engine.filters
      .filter((f) => f.status !== "pass")
      .map((f) => `${f.label} (${f.detail})`)
      .join("; ")}.`,
    warmup: `Carregando o histórico dos últimos 180 segundos (${Math.round(engine.warmupPct * 100)}%) — os dados já estão sendo buscados.`,
  };
  const blockedReason = missingStake
    ? "Informe o valor por aposta em “Sua banca” para registrar o ganho em dinheiro."
    : engine.blockReasons.length > 0
      ? engine.blockReasons.map((r) => reasonText[r] ?? r).join(" ")
      : null;

  // Validação automática a cada 10 minutos (além do botão manual).
  const AUTO_MS = 10 * 60 * 1000;
  const [autoOn, setAutoOn] = useState(true);
  const [nextAutoAt, setNextAutoAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const handlePlace = useCallback(() => {
    placeBet({
      triggerPrice: entryPrice ?? 0,
      target: engine.grossTarget ?? undefined,
      stop: engine.stop ?? undefined,
      hitRate: 0.9,
      sampleSize: engine.ticks,
      stake: bankroll.stake,
      leverage: bankroll.leverage,
      stakeCurrency: bankroll.currency,
      // Congela moeda e câmbio da tela: a aposta mostra exatamente os valores exibidos no clique.
      displayCurrency: bankroll.currency,
      fxAtCreate: quote ? (convertMoney(1, quote, bankroll.currency, usdtBrl) ?? undefined) : undefined,
    });
  }, [placeBet, entryPrice, engine.ticks, engine.grossTarget, engine.stop, bankroll, quote, usdtBrl]);

  const placeRef = useRef(handlePlace);
  placeRef.current = handlePlace;
  const canPlaceRef = useRef(canPlace);
  canPlaceRef.current = canPlace;

  useEffect(() => {
    if (!autoOn) {
      setNextAutoAt(null);
      return;
    }
    setNextAutoAt(Date.now() + AUTO_MS);
    const id = setInterval(() => {
      if (canPlaceRef.current) {
        placeRef.current();
        playNotificationSound("confirmacao");
        toast("Validação automática registrada.", {
          description: "Uma nova aposta entrou na fila aguardando o gatilho.",
        });
      }
      setNextAutoAt(Date.now() + AUTO_MS);
    }, AUTO_MS);
    return () => clearInterval(id);
  }, [autoOn, AUTO_MS]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const autoCountdown = useMemo(() => {
    if (!autoOn || nextAutoAt == null) return null;
    const ms = Math.max(0, nextAutoAt - now);
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}:${String(s).padStart(2, "0")}`;
  }, [autoOn, nextAutoAt, now]);

  const auto2Countdown = (() => {
    if (!auto2On || auto2Next == null) return null;
    const ms = Math.max(0, auto2Next - now);
    const sec = Math.ceil(ms / 1000);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  })();

  const auto3Countdown = (() => {
    if (!auto3On || auto3Next == null) return null;
    const ms = Math.max(0, auto3Next - now);
    const sec = Math.ceil(ms / 1000);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  })();

  const prevCycle = useRef<number | null>(null);
  const notif = useBetNotifications(
    [
      { label: "Manual", bets },
      { label: "Automática", bets: auto2.bets },
      { label: "Ranking", bets: auto3.bets },
      { label: "Supremo", bets: supremoBets.bets },
    ],
    (s) => (s === symbol && livePrice != null ? livePrice : (livePrices.get(s) ?? null)),
  );

  // ===== Resumo para o cabeçalho, barra de estado e título da aba =====
  const allBets = useMemo(
    () => [...bets, ...auto2.bets, ...auto3.bets, ...supremoBets.bets],
    [bets, auto2.bets, auto3.bets, supremoBets.bets],
  );
  const summary = useMemo(() => {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    let today = 0;
    let realized = 0;
    let active = 0;
    for (const b of allBets) {
      if (b.status === "open" || b.status === "pending") active++;
      if (b.status === "win" || b.status === "loss") {
        const v = betPnl(b, null);
        if (isFinite(v)) {
          realized += v;
          if ((b.resolvedAt ?? 0) >= dayStart.getTime()) today += v;
        }
      }
    }
    return { today, realized, active, hitRate: bookStats(allBets).hitRate };
  }, [allBets]);
  useEffect(() => {
    const cd = supremoAuto.countdown;
    let nextCycleAt: number | null = null;
    if (cd) {
      const [m, sec] = cd.split(":").map(Number);
      nextCycleAt = Math.floor(Date.now() / 1000) * 1000 + ((m ?? 0) * 60 + (sec ?? 0)) * 1000;
    }
    publishShellStatus({
      connection: status,
      balance: bankroll.initial > 0 ? bankroll.initial + summary.realized : null,
      currency: bankroll.currency,
      todayPnl: summary.today,
      active: summary.active,
      hitRate: summary.hitRate,
      regime: supremoAuto.regime ? REGIME_LABEL[supremoAuto.regime.regime] : null,
      nextCycleAt: nextCycleAt != null && Math.abs(nextCycleAt - (prevCycle.current ?? 0)) > 1500 ? nextCycleAt : prevCycle.current,
    });
    prevCycle.current = nextCycleAt != null && Math.abs(nextCycleAt - (prevCycle.current ?? 0)) > 1500 ? nextCycleAt : prevCycle.current;
  }, [status, bankroll.initial, bankroll.currency, summary, supremoAuto.regime, supremoAuto.countdown]);

  const { ui, setTab } = useUiLayout();
  const mobileTab = ui.tabs["terminal-mobile"] ?? "apostas";
  const fx = { rate: usdtBrl, at: fxQuery.dataUpdatedAt || null };

  const bestBet = (
    <BestBetPanel
      rows={supremoAuto.scored}
      nextPick={supremoAuto.nextPick}
      scannedAt={supremoAuto.scannedAt}
      fmtPrice={fmtPrice}
      onBet={supremoAuto.betOn}
      onRefresh={supremoAuto.refresh}
      regime={supremoAuto.regime}
    />
  );
  const supremoTracker = (
    <BetTracker
      title="Apostas Supremo"
      description={<>Regra da página <Link to="/supremo" className="underline">Supremo</Link>, nas moedas do painel. Alvo = estrelinha; stop = erro.</>}
      hidePlace
      autoLabel="Gerar aposta Supremo automaticamente a cada 1 minuto"
      extra={ui.focus ? undefined : <SupremoInsights bets={supremoBets.bets} livePrices={livePrices} currency={bankroll.currency} fx={fx} />}
      bets={supremoBets.bets}
      stars={supremoBets.stars}
      losses={supremoBets.losses}
      livePrice={livePrice}
      livePrices={livePrices}
      currency={bankroll.currency}
      usdtBrl={usdtBrl}
      fmtPrice={fmtPrice}
      canPlace={false}
      blockedReason={
        bankroll.stake <= 0
          ? "Informe o valor por aposta em “Sua banca”."
          : supremoAuto.cloudDown
            ? `Atenção: a nuvem não está rodando agora — as apostas só continuam enquanto esta página estiver aberta.${supremoAuto.reason ? ` ${supremoAuto.reason}` : ""}`
            : supremoAuto.reason
      }
      autoOn={supremoAutoOn}
      onToggleAuto={setSupremoAutoOn}
      autoCountdown={supremoAuto.countdown}
      onPlace={() => {}}
      onClear={supremoBets.clearHistory}
      onRemove={supremoBets.removeBet}
    />
  );

  const frame = cn(
    "border-4 transition-colors duration-300",
    flash === "green" && "border-success",
    flash === "red" && "border-destructive",
    flash === "none" && "border-transparent",
  );

  if (ui.focus) {
    return (
      <main className={cn(frame, "mx-auto w-full max-w-5xl space-y-6 px-3 py-6 md:px-6")}>
        <div className="ypx-feature p-1">{bestBet}</div>
        <div id="apostas">{supremoTracker}</div>
      </main>
    );
  }

  const MOBILE_TABS = [
    { id: "apostas", label: "Apostas" },
    { id: "mercado", label: "Mercado" },
    { id: "banca", label: "Banca" },
  ] as const;
  const hideOnMobile = (col: "apostas" | "mercado" | "banca") => mobileTab !== col && "max-md:hidden";

  return (
    <main className={cn(frame, "mx-auto w-full max-w-[1920px] flex-1 px-3 py-4 md:px-6 md:py-6")}>
      <h1 className="sr-only">Ypx Bet — Terminal</h1>
      {symbolsQuery.isError && (
        <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span>Não foi possível acessar os dados de mercado da Binance. Verifique a conexão.</span>
          <button type="button" onClick={() => void symbolsQuery.refetch()} className="min-h-11 rounded-md border border-destructive/40 px-3 font-semibold">
            Tentar de novo
          </button>
        </div>
      )}

      <div role="tablist" aria-label="Seções do terminal" className="mb-4 grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface p-1 md:hidden">
        {MOBILE_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={mobileTab === t.id}
            onClick={() => setTab("terminal-mobile", t.id)}
            className={cn(
              "min-h-11 rounded-md font-display text-sm font-semibold uppercase tracking-wider transition-colors",
              mobileTab === t.id ? "bg-gold text-primary-foreground" : "text-muted-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] xl:grid-cols-[minmax(260px,300px)_minmax(0,1fr)_minmax(360px,420px)] xl:gap-6">
        {/* Centro: preço, apostas, gráfico, motor, histórico */}
        <div className={cn("min-w-0 space-y-5 xl:col-start-2 xl:row-start-1", hideOnMobile("apostas"))}>
          <LivePriceTicker price={livePrice} fmtPrice={fmtPrice} status={status} lastUpdate={lastTickAt} book={book} />
          <div id="apostas" className="scroll-mt-36">{supremoTracker}</div>
          <PriceChart data={chartData} entryPrice={entryPrice} fmtPrice={fmtPrice} />
          <EntryTriggerDisplay engine={engine} fmtPrice={fmtPrice} symbol={symbol} lastUpdate={lastTickAt} />
          <div className="ypx-hairline" aria-hidden />
          <Section id="term-historico" title="Outras trilhas" count={bets.length + auto2.bets.length + auto3.bets.length} description="Manual, automática e ranking — mesma regra de resolução." defaultOpen={false}>
            <div className="grid gap-5 2xl:grid-cols-2">
              <BetTracker
                bets={bets}
                stars={stars}
                losses={losses}
                livePrice={livePrice}
                livePrices={livePrices}
                currency={bankroll.currency}
                usdtBrl={usdtBrl}
                fmtPrice={fmtPrice}
                canPlace={canPlace}
                blockedReason={blockedReason}
                autoOn={autoOn}
                onToggleAuto={setAutoOn}
                autoCountdown={autoCountdown}
                onPlace={handlePlace}
                onClear={clearHistory}
                onRemove={removeBet}
              />
              <BetTracker
                title="Validar aposta 2 (Automática)"
                description="A cada minuto, o par mais estável do último minuto em “Par mais adequado agora” gera uma aposta sozinho. Alvo +0,55% bruto (+0,35% líquido) = estrelinha; −0,55% = erro."
                autoLabel="Gerar aposta automaticamente a cada 1 minuto"
                hidePlace
                bets={auto2.bets}
                stars={auto2.stars}
                losses={auto2.losses}
                livePrice={livePrice}
                livePrices={livePrices}
                currency={bankroll.currency}
                usdtBrl={usdtBrl}
                fmtPrice={fmtPrice}
                canPlace={false}
                blockedReason={missingStake ? "Informe o valor por aposta em “Sua banca” para ativar." : null}
                autoOn={auto2On}
                onToggleAuto={setAuto2On}
                autoCountdown={auto2Countdown}
                onPlace={() => {}}
                onClear={auto2.clearHistory}
                onRemove={auto2.removeBet}
              />
              <BetTracker
                title="Validar aposta 3 Ranking"
                description="A cada minuto, a moeda com maior nota média no último minuto em “Ranking de decisão” gera uma aposta sozinha, no gatilho calculado. Alvo +0,55% bruto (+0,35% líquido) = estrelinha; −0,55% = erro."
                autoLabel="Gerar aposta automaticamente a cada 1 minuto"
                hidePlace
                bets={auto3.bets}
                stars={auto3.stars}
                losses={auto3.losses}
                livePrice={livePrice}
                livePrices={livePrices}
                currency={bankroll.currency}
                usdtBrl={usdtBrl}
                fmtPrice={fmtPrice}
                canPlace={false}
                blockedReason={missingStake ? "Informe o valor por aposta em “Sua banca” para ativar." : null}
                autoOn={auto3On}
                onToggleAuto={setAuto3On}
                autoCountdown={auto3Countdown}
                onPlace={() => {}}
                onClear={auto3.clearHistory}
                onRemove={auto3.removeBet}
              />
            </div>
          </Section>
        </div>

        {/* Laterais: em telas médias ficam empilhadas na 2ª coluna */}
        <div className="min-w-0 space-y-5 xl:contents">
          <aside aria-label="Moeda e banca" className={cn("min-w-0 space-y-5 xl:col-start-1 xl:row-start-1", hideOnMobile("banca"))}>
            <div className="ypx-card p-4">
              <p className="ypx-label mb-2">Moeda em exibição</p>
              <CoinSelector symbols={selectorSymbols} value={symbol} onChange={setSymbol} />
            </div>
            <BankrollPanel
              initial={bankroll.initial}
              stake={bankroll.stake}
              leverage={bankroll.leverage}
              currency={bankroll.currency}
              realizedPnl={realizedPnl}
              openPnl={openPnl}
              usdtBrl={usdtBrl}
              leveraged={bankroll.leveraged}
              onInitial={setInitial}
              onStake={setStake}
              onLeveraged={setLeveraged}
              onCurrency={setCurrency}
            />
            {notif.permission !== "unsupported" && (
              <button
                type="button"
                onClick={notif.request}
                disabled={notif.permission !== "default"}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border px-3 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-70"
              >
                {notif.permission === "granted" ? <Bell className="size-4" strokeWidth={1.75} aria-hidden /> : <BellOff className="size-4" strokeWidth={1.75} aria-hidden />}
                {notif.permission === "granted"
                  ? "Notificações ativas"
                  : notif.permission === "denied"
                    ? "Notificações bloqueadas no navegador"
                    : "Ativar notificações"}
              </button>
            )}
            <Section id="term-filtros" title="Filtros e custos" defaultOpen={false}>
              <FilterPanel engine={engine} mode={engineMode} onModeChange={setEngineMode} symbol={symbol} />
            </Section>
            <Section id="term-lab" title="Laboratório" defaultOpen={false}>
              <SupremoLab />
            </Section>
          </aside>

          <aside aria-label="Melhor aposta e ranking" className={cn("min-w-0 space-y-5 xl:col-start-3 xl:row-start-1", hideOnMobile("mercado"))}>
            <div className="ypx-feature p-1">{bestBet}</div>
            <SupremoRanking
              bets={supremoBets.bets}
              scored={supremoAuto.scored}
              nextPick={supremoAuto.nextPick}
              scannedAt={supremoAuto.scannedAt}
              livePrices={livePrices}
              fx={fx}
            />
            <SupremoEconomia bets={supremoBets.bets} symbols={supremoAuto.scored.map((r) => r.symbol)} fx={fx} />
            <Section id="term-decisao" title="Ranking de decisão" defaultOpen={false}>
              <DecisionRankingTable pairs={pairRanking.pairs} engines={pairRanking.decisionEngines} livePrices={livePrices} />
            </Section>
            <Section id="term-pares" title="Par mais adequado agora" defaultOpen={false}>
              <PairRankingCard ranked={pairRanking.ranked} stream={pairRanking.stream} selected={symbol} onSelect={setSymbol} />
            </Section>
          </aside>
        </div>
      </div>
    </main>
  );
}
