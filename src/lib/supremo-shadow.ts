/**
 * Oportunidade perdida (sombra): para apostas canceladas porque o preço
 * passou do alvo sem armar, simula a entrada a mercado no instante da criação
 * com a mesma combinação. Só informativo — nunca cria aposta real.
 */
import type { Bet } from "@/hooks/useBets";
import type { Candle } from "./replay";
import { combinacaoDaAposta, economiaDaCombinacao } from "./supremo-economics";
import { PASSED_TARGET_REASON } from "./supremo-penalty";
import { toUsdt, round2, type FxQuote } from "./fx-totals";

export const SHADOW_KEY = "supremo-shadow-v1";
export const SHADOW_HORIZON_MS = 60 * 60_000;

export type ShadowOutcome = "alvo" | "stop" | "expirou";
export type ShadowEntry = { id: string; outcome: ShadowOutcome; netPct: number; netUsdt: number | null; at: number };

export const isShadowCandidate = (b: Pick<Bet, "status" | "cancelReason">) =>
  b.status === "cancelled" && b.cancelReason === PASSED_TARGET_REASON;

/** Entrada a mercado em priceAtCreate; mesma vela com alvo e stop = derrota. */
export function simulateShadow(
  b: Pick<Bet, "priceAtCreate" | "createdAt" | "combo" | "target" | "stop" | "triggerPrice">,
  candles: readonly Candle[],
  horizon = SHADOW_HORIZON_MS,
): { outcome: ShadowOutcome; netPct: number } {
  const c = combinacaoDaAposta(b);
  const e = economiaDaCombinacao(c);
  const entry = b.priceAtCreate;
  const target = entry * (1 + c.alvoBruto);
  const stop = entry / (1 + c.stopBruto);
  for (const k of candles) {
    if (k.time < b.createdAt) continue;
    if (k.time >= b.createdAt + horizon) break;
    const hitT = k.high >= target, hitS = k.low <= stop;
    if (hitS) return { outcome: "stop", netPct: -e.perdaLiquida };
    if (hitT) return { outcome: "alvo", netPct: e.ganhoLiquido };
  }
  const last = [...candles].reverse().find((k) => k.time < b.createdAt + horizon);
  const gross = last ? (last.close - entry) / entry : 0;
  return { outcome: "expirou", netPct: gross - c.taxaIdaVolta };
}

export function shadowEntry(b: Bet, candles: readonly Candle[], fx: FxQuote | null | undefined, now: number): ShadowEntry {
  const s = simulateShadow(b, candles);
  const v = toUsdt(b.stake * b.leverage * s.netPct, b.stakeCurrency ?? "USDT", fx, now);
  return { id: b.id, ...s, netUsdt: v.ok ? round2(v.usdt) : null, at: now };
}

export function resumoSombra(bets: readonly Bet[], store: Record<string, ShadowEntry>) {
  const cands = bets.filter(isShadowCandidate);
  const done = cands.map((b) => store[b.id]).filter((x): x is ShadowEntry => !!x);
  return {
    canceladas: cands.length,
    simuladas: done.length,
    alvo: done.filter((d) => d.outcome === "alvo").length,
    stop: done.filter((d) => d.outcome === "stop").length,
    expiradas: done.filter((d) => d.outcome === "expirou").length,
    lucroUsdt: round2(done.reduce((s, d) => s + (d.netUsdt ?? 0), 0)),
  };
}

export function readShadow(): Record<string, ShadowEntry> {
  try {
    const v = JSON.parse(localStorage.getItem(SHADOW_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function writeShadow(m: Record<string, ShadowEntry>) {
  try {
    localStorage.setItem(SHADOW_KEY, JSON.stringify(m));
  } catch {
    /* silencioso */
  }
}
