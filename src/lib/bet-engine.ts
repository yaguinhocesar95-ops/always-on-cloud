/**
 * Regras puras das apostas (sem React): criação, avanço por preço e mescla
 * entre cópias (navegador × servidor). Usadas pelo hook useBets e pela
 * rodada automática no servidor.
 */
import type { Bet, SupremoMeta } from "@/hooks/useBets";
import type { DisplayCurrency } from "@/lib/money";
import { GROSS_TARGET_PCT } from "@/lib/scalp";
import { pendingExpiry } from "@/lib/supremo-expiry";

export const PRICE_EVENT_EVERY_MS = 30_000;

export function genBetId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c?.randomUUID ? c.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export type NewBetOpts = {
  triggerPrice: number;
  target?: number | undefined;
  stop?: number | undefined;
  hitRate: number;
  sampleSize: number;
  stake: number;
  leverage: number;
  stakeCurrency: DisplayCurrency;
  displayCurrency?: DisplayCurrency | undefined;
  fxAtCreate?: number | undefined;
  symbol?: string | undefined;
  quote?: string | undefined;
  priceNow?: number | undefined;
  combo?: string | undefined;
  supremoMeta?: SupremoMeta | undefined;
  starsAtCreate?: number | undefined;
  scoreAtCreate?: number | undefined;
  regimeAtCreate?: string | undefined;
};

/** Monta uma aposta nova; devolve null se os números forem inválidos. */
export function buildBet(opts: NewBetOpts, symbol: string | null, quote: string, nowPx: number | null, createdAt: number): Bet | null {
  const betSymbol = opts.symbol ?? symbol;
  const betQuote = opts.quote ?? quote;
  const px = opts.priceNow ?? nowPx;
  if (!betSymbol || px == null) return null;
  const trigger = opts.triggerPrice;
  if (!isFinite(trigger) || trigger <= 0) return null;
  const target = Number(opts.target ?? trigger * (1 + GROSS_TARGET_PCT));
  const stop = Number(opts.stop ?? trigger / (1 + GROSS_TARGET_PCT));
  if (!isFinite(target) || !isFinite(stop)) return null;
  return {
    id: genBetId(),
    symbol: betSymbol,
    quote: betQuote,
    triggerPrice: trigger,
    entryPrice: trigger,
    target,
    stop,
    hitRate: opts.hitRate,
    sampleSize: opts.sampleSize,
    createdAt,
    armedAt: null,
    resolvedAt: null,
    status: "pending",
    priceAtCreate: px,
    best: trigger,
    worst: trigger,
    stake: opts.stake,
    leverage: opts.leverage,
    stakeCurrency: opts.stakeCurrency,
    displayCurrency: opts.displayCurrency,
    fxAtCreate: opts.fxAtCreate,
    ...(opts.combo ? { combo: opts.combo } : {}),
    ...(opts.supremoMeta ? { supremoMeta: opts.supremoMeta } : {}),
    ...(opts.starsAtCreate != null ? { starsAtCreate: opts.starsAtCreate } : {}),
    ...(opts.scoreAtCreate != null ? { scoreAtCreate: opts.scoreAtCreate } : {}),
    ...(opts.regimeAtCreate ? { regimeAtCreate: opts.regimeAtCreate } : {}),
    lastPrice: px,
    lastPriceAt: createdAt,
    events: [{ t: createdAt, type: "criada" as const, price: px }],
  };
}

export type AdvanceKind = "armed" | "win" | "loss" | null;

/** Avança uma aposta com o preço atual. Devolve a mesma referência se nada mudou. */
export function advanceBet(orig: Bet, px: number | null, t: number, expirePending: boolean): { bet: Bet; kind: AdvanceKind } {
  if (expirePending && orig.status === "pending") {
    const d = pendingExpiry(orig, px != null && isFinite(px) ? px : null, t);
    if (d.cancel) {
      return {
        bet: {
          ...orig,
          status: "cancelled",
          resolvedAt: t,
          cancelReason: d.reason,
          farSince: null,
          events: [...(orig.events ?? []), { t, type: "cancelada", note: d.reason, ...(px != null ? { price: px } : {}) }],
        },
        kind: null,
      };
    }
    if ((orig.farSince ?? null) !== d.farSince) orig = { ...orig, farSince: d.farSince };
  }
  if (px == null || !isFinite(px) || px <= 0) return { bet: orig, kind: null };
  const b = orig;
  if (b.status === "pending") {
    const touched = b.priceAtCreate <= b.triggerPrice ? px >= b.triggerPrice : px <= b.triggerPrice;
    if (!touched) return { bet: b, kind: null };
    return {
      bet: {
        ...b,
        status: "open",
        armedAt: t,
        lastPrice: px,
        lastPriceAt: t,
        events: [...(b.events ?? []), { t, type: "gatilho", price: px }, { t, type: "entrada", price: b.entryPrice }],
        best: b.triggerPrice,
        worst: b.triggerPrice,
      },
      kind: "armed",
    };
  }
  if (b.status !== "open" || b.armedAt == null) return { bet: b, kind: null };
  if (!(b.target > b.entryPrice) || !(b.stop < b.entryPrice)) return { bet: b, kind: null };
  const best = Math.max(b.best, px);
  const worst = Math.min(b.worst, px);
  if (px >= b.target) {
    return {
      bet: { ...b, best, worst, status: "win", resolvedAt: t, lastPrice: px, lastPriceAt: t,
        events: [...(b.events ?? []), { t, type: "alvo", price: px }, { t, type: "encerrada", price: b.target }] },
      kind: "win",
    };
  }
  if (px <= b.stop) {
    return {
      bet: { ...b, best, worst, status: "loss", resolvedAt: t, lastPrice: px, lastPriceAt: t,
        events: [...(b.events ?? []), { t, type: "stop", price: px }, { t, type: "encerrada", price: b.stop }] },
      kind: "loss",
    };
  }
  const logPrice = px !== b.lastPrice && t - (b.lastPriceAt ?? 0) >= PRICE_EVENT_EVERY_MS;
  if (best === b.best && worst === b.worst && !logPrice) return { bet: b, kind: null };
  return {
    bet: logPrice
      ? { ...b, best, worst, lastPrice: px, lastPriceAt: t, events: [...(b.events ?? []), { t, type: "preco", price: px }] }
      : { ...b, best, worst },
    kind: null,
  };
}

const rank = (b: Bet) => (b.status === "pending" ? 0 : b.status === "open" ? 1 : 2);

/** Escolhe a cópia mais avançada de uma mesma aposta. */
function pick(a: Bet, b: Bet): Bet {
  if (rank(a) !== rank(b)) return rank(a) > rank(b) ? a : b;
  return (b.events?.length ?? 0) > (a.events?.length ?? 0) ? b : a;
}

/** Junta duas listas de apostas por id (mais nova primeiro), ignorando as apagadas. */
export function mergeBets(a: readonly Bet[], b: readonly Bet[], deleted: ReadonlySet<string> = new Set()): Bet[] {
  const map = new Map<string, Bet>();
  for (const x of [...a, ...b]) {
    if (!x || typeof x !== "object" || !x.id || deleted.has(x.id)) continue;
    const cur = map.get(x.id);
    map.set(x.id, cur ? pick(cur, x) : x);
  }
  return [...map.values()].sort((x, y) => y.createdAt - x.createdAt);
}
