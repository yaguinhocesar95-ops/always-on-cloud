/**
 * Totais financeiros em moeda-base USDT.
 * Nunca soma moedas diferentes sem conversão. Sem cotação válida e recente,
 * o valor fica FORA do total e é listado como "aguardando cotação".
 * O valor original da aposta nunca é alterado.
 */
import type { Bet } from "@/hooks/useBets";
import { betPnl } from "@/hooks/useBets";

export const BASE_CURRENCY = "USDT" as const;
/** Cotação USDT/BRL mais velha que isso é considerada velha. */
export const FX_MAX_AGE_MS = 5 * 60_000;

/** 1 USDT = `rate` BRL, obtida em `at` (ms). */
export type FxQuote = { rate: number | null | undefined; at: number | null | undefined };
export type FxStatus = "ok" | "ausente" | "velha" | "invalida";

export function fxStatus(q: FxQuote | null | undefined, now: number, maxAge = FX_MAX_AGE_MS): FxStatus {
  if (!q || q.rate == null || q.at == null) return "ausente";
  if (!Number.isFinite(q.rate) || q.rate <= 0 || !Number.isFinite(q.at)) return "invalida";
  if (now - q.at > maxAge) return "velha";
  return "ok";
}

export const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export type Converted =
  | { ok: true; usdt: number; original: number; currency: string; rate: number | null }
  | { ok: false; original: number; currency: string; reason: FxStatus | "moeda-desconhecida" | "valor-invalido" };

export function toUsdt(value: number, currency: string, q: FxQuote | null | undefined, now: number): Converted {
  if (!Number.isFinite(value)) return { ok: false, original: value, currency, reason: "valor-invalido" };
  if (currency === "USDT") return { ok: true, usdt: value, original: value, currency, rate: null };
  if (currency !== "BRL") return { ok: false, original: value, currency, reason: "moeda-desconhecida" };
  const st = fxStatus(q, now);
  if (st !== "ok") return { ok: false, original: value, currency, reason: st };
  return { ok: true, usdt: value / q!.rate!, original: value, currency, rate: q!.rate! };
}

export type UsdtItem = { id: string; label: string; value: number; currency: string };
export type UsdtTotal = {
  total: number;
  /** Itens que entraram (com o valor original e o convertido). */
  included: (UsdtItem & { usdt: number })[];
  /** Itens fora do total por falta de cotação válida. */
  excluded: (UsdtItem & { reason: string })[];
};

export function sumUsdt(items: readonly UsdtItem[], q: FxQuote | null | undefined, now: number): UsdtTotal {
  let total = 0;
  const included: UsdtTotal["included"] = [];
  const excluded: UsdtTotal["excluded"] = [];
  for (const it of items) {
    const c = toUsdt(it.value, it.currency, q, now);
    if (c.ok) {
      total += c.usdt;
      included.push({ ...it, usdt: c.usdt });
    } else excluded.push({ ...it, reason: c.reason });
  }
  return { total: round2(total), included, excluded };
}

const cur = (b: Bet) => b.stakeCurrency ?? "USDT";

export type UsdtFinancials = {
  realized: UsdtTotal;
  unrealized: UsdtTotal;
  awaiting: UsdtTotal;
  combined: number;
  /** Apostas valendo sem preço atual da moeda. */
  unpriced: number;
  exposure: UsdtTotal;
  perCoin: { symbol: string; count: number; usdt: number; share: number }[];
};

export function financialsUsdt(
  bets: readonly Bet[],
  priceFor: (symbol: string) => number | null,
  q: FxQuote | null | undefined,
  now: number,
): UsdtFinancials {
  const realized: UsdtItem[] = [], unrealized: UsdtItem[] = [], awaiting: UsdtItem[] = [], exposure: UsdtItem[] = [];
  let unpriced = 0;
  for (const b of bets) {
    const base = { id: b.id, label: b.symbol, currency: cur(b) };
    if (b.status === "win" || b.status === "loss") realized.push({ ...base, value: betPnl(b, null) });
    else if (b.status === "open") {
      const px = priceFor(b.symbol);
      if (px == null) unpriced++;
      else unrealized.push({ ...base, value: betPnl(b, px) });
    } else if (b.status === "pending") awaiting.push({ ...base, value: b.stake });
    if (b.status === "open" || b.status === "pending") exposure.push({ ...base, value: b.stake * b.leverage });
  }
  const r = sumUsdt(realized, q, now), u = sumUsdt(unrealized, q, now), a = sumUsdt(awaiting, q, now), e = sumUsdt(exposure, q, now);
  const per = new Map<string, { count: number; usdt: number }>();
  for (const it of e.included) {
    const p = per.get(it.label) ?? { count: 0, usdt: 0 };
    p.count++;
    p.usdt += it.usdt;
    per.set(it.label, p);
  }
  const perCoin = [...per.entries()]
    .map(([symbol, v]) => ({ symbol, count: v.count, usdt: round2(v.usdt), share: e.total > 0 ? v.usdt / e.total : 0 }))
    .sort((x, y) => y.usdt - x.usdt);
  return { realized: r, unrealized: u, awaiting: a, combined: round2(r.total + u.total), unpriced, exposure: e, perCoin };
}

const brl = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

/** "R$ 1.500,00 → US$ 270,00 USDT" */
export function conversionText(value: number, currency: string, q: FxQuote | null | undefined, now: number): string {
  const c = toUsdt(value, currency, q, now);
  const orig = currency === "BRL" ? `R$ ${brl(value)}` : `US$ ${brl(value)} ${currency}`;
  if (!c.ok) return `${orig} → aguardando cotação`;
  return currency === "USDT" ? orig : `${orig} → US$ ${brl(round2(c.usdt))} USDT`;
}

export function rateText(q: FxQuote | null | undefined): string {
  return q?.rate && Number.isFinite(q.rate) ? `Cotação: 1 USDT = R$ ${brl(q.rate, 4)}` : "Cotação: aguardando cotação";
}
