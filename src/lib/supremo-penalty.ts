/**
 * Memória de derrota por moeda, pausa global pós-derrota e bloqueio
 * "em-alta-recente" (puro). Derivado das próprias apostas resolvidas; o
 * snapshot é gravado em supremo-penalty-v1 só para consulta.
 */
import type { Bet } from "@/hooks/useBets";

export const PENALTY_STEPS_MS = [30 * 60_000, 2 * 3_600_000, 6 * 3_600_000] as const;
export const TWO_OF_THREE_MS = 2 * 3_600_000;
export const GLOBAL_PAUSE_MS = 10 * 60_000;
export const HOT_RECENT_MS = 15 * 60_000;
export const PASSED_TARGET_REASON = "preço passou do alvo sem armar";
export const PENALTY_KEY = "supremo-penalty-v1";

type B = Pick<Bet, "symbol" | "status" | "resolvedAt"> & { cancelReason?: string | undefined };

export type Penalty = { block: "derrota-recente"; until: number; reason: string };

const resolvedOf = (bets: readonly B[], symbol: string) =>
  bets
    .filter((b) => b.symbol === symbol && (b.status === "win" || b.status === "loss") && b.resolvedAt != null)
    .sort((a, b) => b.resolvedAt! - a.resolvedAt!);

/** Penalidade ativa da moeda, ou null. */
export function coinPenalty(bets: readonly B[], symbol: string, now: number): Penalty | null {
  const res = resolvedOf(bets, symbol);
  if (res.length === 0 || res[0]!.status !== "loss") return null;
  let streak = 0;
  for (const b of res) {
    if (b.status !== "loss") break;
    streak++;
  }
  const lastLoss = res[0]!.resolvedAt!;
  const step = PENALTY_STEPS_MS[Math.min(streak, 3) - 1]!;
  let until = lastLoss + step;
  let reason = `${streak}ª derrota seguida`;
  const last3 = res.slice(0, 3);
  if (last3.length === 3 && last3.filter((b) => b.status === "loss").length >= 2) {
    const u2 = lastLoss + TWO_OF_THREE_MS;
    if (u2 > until) {
      until = u2;
      reason = "perdeu 2 das últimas 3";
    }
  }
  return until > now ? { block: "derrota-recente", until, reason } : null;
}

/** Fim da pausa global (10 min após qualquer derrota), ou null. */
export function globalPauseUntil(bets: readonly B[], now: number): number | null {
  let last = 0;
  for (const b of bets) if (b.status === "loss" && b.resolvedAt != null && b.resolvedAt > last) last = b.resolvedAt;
  const until = last + GLOBAL_PAUSE_MS;
  return last > 0 && until > now ? until : null;
}

/** Fim do bloqueio "em-alta-recente" (cancelada por passar do alvo), ou null. */
export function hotRecentUntil(bets: readonly B[], symbol: string, now: number): number | null {
  let last = 0;
  for (const b of bets)
    if (b.symbol === symbol && b.status === "cancelled" && b.cancelReason === PASSED_TARGET_REASON && (b.resolvedAt ?? 0) > last)
      last = b.resolvedAt!;
  const until = last + HOT_RECENT_MS;
  return last > 0 && until > now ? until : null;
}

export function remainingText(until: number, now: number): string {
  const m = Math.max(1, Math.ceil((until - now) / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

export function writePenaltySnapshot(snap: Record<string, Penalty>) {
  try {
    localStorage.setItem(PENALTY_KEY, JSON.stringify(snap));
  } catch {
    /* ignore */
  }
}
