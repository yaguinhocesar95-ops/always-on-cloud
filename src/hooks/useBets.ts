import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DisplayCurrency } from "@/lib/money";
import { FEE_ROUND_TRIP_PCT, GROSS_TARGET_PCT } from "@/lib/scalp";

import { advanceBet, buildBet, mergeBets, type NewBetOpts } from "@/lib/bet-engine";
import { CLOUD_PULL_EVENT, addTombstones, readTombstones } from "@/lib/cloud-keys";
export { genBetId, PRICE_EVENT_EVERY_MS } from "@/lib/bet-engine";

export type BetStatus = "pending" | "open" | "win" | "loss" | "cancelled";

export type BetEventType = "criada" | "gatilho" | "entrada" | "preco" | "alvo" | "stop" | "encerrada" | "cancelada";
export type BetEvent = { t: number; type: BetEventType; price?: number | undefined; note?: string | undefined };

/** Pontuação histórica no momento do registro (trilha Supremo). */
export type SupremoMeta = { score: number; stars: number; hitRate: number | null; cycles: number };

export type Bet = {
  id: string;
  symbol: string;
  quote: string;
  /** Preço do gatilho: é daqui que o alvo e o stop são calculados. */
  triggerPrice: number;
  /** Igual ao gatilho — a aposta só começa a valer quando o preço encosta nele. */
  entryPrice: number;
  target: number;
  stop: number;
  hitRate: number;
  sampleSize: number;
  createdAt: number;
  /** Momento em que o preço tocou o gatilho e a aposta passou a valer. */
  armedAt: number | null;
  resolvedAt: number | null;
  status: BetStatus;
  /** Preço de mercado no instante em que a aposta foi registrada. */
  priceAtCreate: number;
  best: number;
  worst: number;
  /** Valor apostado (margem) na moeda declarada pelo usuário. */
  stake: number;
  leverage: number;
  stakeCurrency: DisplayCurrency;
  /** Moeda em que os preços estavam na tela no registro. */
  displayCurrency?: DisplayCurrency | undefined;
  /** Câmbio congelado no registro (preço do par × fxAtCreate = preço exibido). */
  fxAtCreate?: number | undefined;
  /** Combinação alvo/stop que gerou a aposta (trilha Supremo). */
  combo?: string | undefined;
  /** Linha do tempo (apenas acréscimos — nada é apagado). */
  events?: BetEvent[] | undefined;
  /** Último preço registrado na linha do tempo e quando. */
  lastPrice?: number | null | undefined;
  lastPriceAt?: number | null | undefined;
  supremoMeta?: SupremoMeta | undefined;
  /** Desde quando o preço está > 1% acima do gatilho (expiração Supremo). */
  farSince?: number | null | undefined;
  cancelReason?: string | undefined;
  /** Informativo (não travado): estrelinhas e pontuação da moeda no registro. */
  starsAtCreate?: number | undefined;
  scoreAtCreate?: number | undefined;
  /** Informativo (não travado): regime de mercado no registro. */
  regimeAtCreate?: string | undefined;
};

const STORAGE_KEY = "scalp-terminal-bets-v4";

/**
 * Alvo e stop são BRUTOS de ±0,55% a partir do gatilho — exatamente os números
 * exibidos no painel. Descontadas as taxas (0,20% ida e volta), o acerto vale
 * +0,35% líquido e o stop custa −0,75% líquido.
 */
export const TARGET_PCT = GROSS_TARGET_PCT;
export const STOP_PCT = GROSS_TARGET_PCT;
export const NET_WIN_PCT = GROSS_TARGET_PCT - FEE_ROUND_TRIP_PCT; // +0,35%
export const NET_LOSS_PCT = -(GROSS_TARGET_PCT + FEE_ROUND_TRIP_PCT); // −0,75%

/** Variação LÍQUIDA (já com taxas) em relação ao gatilho, sem alavancagem. */
export function betVariation(bet: Bet, livePrice: number | null): number {
  if (bet.status === "pending" || bet.status === "cancelled") return 0;
  const ref =
    bet.status === "open"
      ? (livePrice ?? bet.entryPrice)
      : bet.status === "win"
        ? bet.target
        : bet.stop;
  const gross = (ref - bet.entryPrice) / bet.entryPrice;
  // As taxas corroem em qualquer direção, inclusive nas apostas em aberto.
  return gross - FEE_ROUND_TRIP_PCT;
}

/** Ganho/perda em dinheiro: valor apostado × alavancagem × variação. */
export function betPnl(bet: Bet, livePrice: number | null): number {
  return bet.stake * bet.leverage * betVariation(bet, livePrice);
}

/** Distância em % do preço atual até o gatilho ainda não acionado. */
export function betTriggerDistancePct(bet: Bet, livePrice: number | null): number | null {
  if (bet.status !== "pending" || livePrice == null || livePrice <= 0) return null;
  return ((bet.triggerPrice - livePrice) / livePrice) * 100;
}

/** Campos gravados no registro da aposta — NUNCA podem mudar depois disso. */
const LOCKED_KEYS = [
  "id",
  "symbol",
  "quote",
  "triggerPrice",
  "entryPrice",
  "target",
  "stop",
  "createdAt",
  "priceAtCreate",
  "stake",
  "leverage",
  "stakeCurrency",
  "displayCurrency",
  "fxAtCreate",
  "combo",
] as const;
type LockedFields = Pick<Bet, (typeof LOCKED_KEYS)[number]>;

function snapshotLocked(b: Bet): Readonly<LockedFields> {
  const snap = {} as Record<string, unknown>;
  for (const k of LOCKED_KEYS) snap[k] = b[k];
  return Object.freeze(snap) as Readonly<LockedFields>;
}

export function useBets(
  symbol: string | null,
  livePrice: number | null,
  quote: string,
  livePrices?: Map<string, number>,
  storageKey: string = STORAGE_KEY,
  /** Só a trilha Supremo: cancela pendentes que não armaram (ver supremo-expiry). */
  expirePending = false,
) {
  const [bets, setBetsRaw] = useState<Bet[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [justWon, setJustWon] = useState<string | null>(null);
  const [justArmed, setJustArmed] = useState<string | null>(null);
  const [justLost, setJustLost] = useState<string | null>(null);
  // Cópia congelada dos valores de registro de cada aposta. Qualquer atualização
  // de estado passa por aqui e tem alvo/gatilho/limite restaurados do registro.
  const lockedRef = useRef(new Map<string, Readonly<LockedFields>>());
  const enforceLocked = useCallback((list: Bet[]): Bet[] => {
    const locks = lockedRef.current;
    let mutated = false;
    const out = list.map((b) => {
      let lock = locks.get(b.id);
      if (!lock) {
        lock = snapshotLocked(b);
        locks.set(b.id, lock);
        return b;
      }
      for (const k of LOCKED_KEYS) {
        if (b[k] !== lock[k]) {
          mutated = true;
          return { ...b, ...lock };
        }
      }
      return b;
    });
    return mutated ? out : list;
  }, []);
  const setBets = useCallback(
    (update: Bet[] | ((prev: Bet[]) => Bet[])) => {
      setBetsRaw((prev) => enforceLocked(typeof update === "function" ? update(prev) : update));
    },
    [enforceLocked],
  );
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const stored = (JSON.parse(raw) as Bet[]).map((s): Bet => {
          // Corrige estrelinhas falsas antigas: vitória no mesmo instante do
          // acionamento (ou sem acionamento) nunca atingiu o objetivo de fato.
          const bogus =
            (s.status === "win" || s.status === "loss") &&
            (s.armedAt == null || s.resolvedAt == null || s.resolvedAt - s.armedAt < 1);
          return bogus
            ? { ...s, status: "pending", armedAt: null, resolvedAt: null, best: s.triggerPrice, worst: s.triggerPrice }
            : s;
        });
        // Mantém apostas registradas antes da leitura do armazenamento.
        setBets((prev) => [...prev, ...stored.filter((s) => !prev.some((p) => p.id === s.id))]);
      }
    } catch {
      /* ignore corrupt storage */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(bets));
    } catch {
      /* storage full or unavailable */
    }
  }, [bets, hydrated]);

  // A cada tick: aciona apostas que tocaram o gatilho e avalia as que já valem —
  // de TODOS os pares com preço conhecido, não só o que está na tela.
  useEffect(() => {
    const priceFor = (s: string) =>
      s === symbol && livePrice != null ? livePrice : (livePrices?.get(s) ?? null);
    setBets((prev) => {
      let changed = false;
      const t = Date.now();
      const next = prev.map((orig) => {
        const r = advanceBet(orig, priceFor(orig.symbol), t, expirePending);
        if (r.bet !== orig) changed = true;
        if (r.kind === "armed") setJustArmed(r.bet.id);
        else if (r.kind === "win") setJustWon(r.bet.id);
        else if (r.kind === "loss") setJustLost(r.bet.id);
        return r.bet;
      });
      return changed ? next : prev;
    });
  }, [livePrice, livePrices, symbol, setBets, expirePending]);

  // Apostas vindas da nuvem (rodada automática no servidor): mescla na lista.
  useEffect(() => {
    const onPull = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== storageKey) return;
      try {
        const remote = JSON.parse(localStorage.getItem(storageKey) ?? "[]") as Bet[];
        const dead = readTombstones();
        setBets((prev) => mergeBets(prev, remote, dead));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener(CLOUD_PULL_EVENT, onPull);
    return () => window.removeEventListener(CLOUD_PULL_EVENT, onPull);
  }, [storageKey, setBets]);

  const placeBet = useCallback(
    (
      opts: NewBetOpts & {
        guard?: ((current: Bet[]) => string | null) | undefined;
        onBlocked?: ((reason: string) => void) | undefined;
      },
    ) => {
      const bet = buildBet(opts, symbol, quote, livePrice, Date.now());
      if (!bet) return;
      setBets((prev) => {
        const blocked = opts.guard?.(prev) ?? null;
        if (blocked) {
          queueMicrotask(() => opts.onBlocked?.(blocked));
          return prev;
        }
        return [bet, ...prev];
      });
    },
    [symbol, livePrice, quote, setBets],
  );

  const clearHistory = useCallback(() => {
    lockedRef.current.clear();
    setBets((prev) => {
      addTombstones(prev.map((b) => b.id));
      return [];
    });
  }, [setBets]);
  const removeBet = useCallback(
    (id: string) => {
      lockedRef.current.delete(id);
      addTombstones([id]);
      setBets((prev) => prev.filter((b) => b.id !== id));
    },
    [setBets],
  );
  const clearJustWon = useCallback(() => setJustWon(null), []);
  const clearJustArmed = useCallback(() => setJustArmed(null), []);
  const clearJustLost = useCallback(() => setJustLost(null), []);

  const stars = bets.filter((b) => b.status === "win").length;
  const losses = bets.filter((b) => b.status === "loss").length;
  const pending = useMemo(() => bets.filter((b) => b.status === "pending"), [bets]);
  const open = useMemo(() => bets.filter((b) => b.status === "open"), [bets]);

  /** Resultado já realizado (apostas fechadas), na moeda em que foram feitas. */
  const realizedPnl = useMemo(
    () =>
      bets
        .filter((b) => b.status === "win" || b.status === "loss")
        .reduce((sum, b) => sum + betPnl(b, null), 0),
    [bets],
  );

  /** Resultado das apostas já acionadas, marcado a preço de mercado. */
  const openPnl = useMemo(
    () =>
      open.reduce((sum, b) => {
        // Cada aposta usa o preço da PRÓPRIA moeda.
        const px = b.symbol === symbol && livePrice != null ? livePrice : (livePrices?.get(b.symbol) ?? null);
        return sum + betPnl(b, px);
      }, 0),
    [open, livePrice, symbol, livePrices],
  );

  return {
    bets,
    open,
    pending,
    stars,
    losses,
    realizedPnl,
    openPnl,
    placeBet,
    clearHistory,
    removeBet,
    justWon,
    clearJustWon,
    justArmed,
    clearJustArmed,
    justLost,
    clearJustLost,
    hydrated,
  };
}
