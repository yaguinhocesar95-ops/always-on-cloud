/** Chaves guardadas na nuvem e utilidades compartilhadas (navegador e servidor). */
export const CLOUD_PULL_EVENT = "ypx-cloud-pull";

export const SUPREMO_BETS_KEY = "scalp-terminal-bets-supremo-v1";
export const BET_KEYS = [
  "scalp-terminal-bets-v4",
  "scalp-terminal-bets-auto2-v1",
  "scalp-terminal-bets-auto3-v1",
  SUPREMO_BETS_KEY,
] as const;
export const BANKROLL_KEY = "scalp-terminal-bankroll-v2";
export const AUTO_ON_KEY = "ypx-supremo-auto-on";
export const TOMBSTONE_KEY = "ypx-bets-tombstones";
export const AUDIT_KEY = "supremo-audit-v1";
export const SCALAR_KEYS = [
  BANKROLL_KEY,
  AUTO_ON_KEY,
  "supremo-active-combo-v1",
  "supremo-exposure-v1",
  "supremo-trauma-v1",
] as const;
/** Horário (ms) da última rodada da nuvem que conseguiu preços; só o servidor grava. */
export const CLOUD_BEAT_KEY = "ypx-cloud-beat";
export const ALL_SYNC_KEYS: string[] = [...BET_KEYS, ...SCALAR_KEYS, TOMBSTONE_KEY, AUDIT_KEY, "ypx-reset-day", CLOUD_BEAT_KEY];

const hasLS = () => typeof localStorage !== "undefined";

export function readTombstones(): Set<string> {
  if (!hasLS()) return new Set();
  try {
    const v = JSON.parse(localStorage.getItem(TOMBSTONE_KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v : []);
  } catch {
    return new Set();
  }
}

export function addTombstones(ids: string[]) {
  if (!hasLS() || ids.length === 0) return;
  const s = readTombstones();
  for (const id of ids) s.add(id);
  localStorage.setItem(TOMBSTONE_KEY, JSON.stringify([...s].slice(-5000)));
}

export function readAutoOn(): boolean {
  if (!hasLS()) return true;
  return localStorage.getItem(AUTO_ON_KEY) !== "false";
}

export function emitCloudPull(key: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CLOUD_PULL_EVENT, { detail: key }));
}

/** Reset diário: apostas, auditoria e marcadores são zerados à meia-noite (horário de Brasília). */
export const RESET_DAY_KEY = "ypx-reset-day";
export const DAILY_RESET_KEYS: string[] = [...BET_KEYS, AUDIT_KEY, TOMBSTONE_KEY];
export function saoPauloDay(now: number = Date.now()): string {
  return new Date(now - 3 * 3600_000).toISOString().slice(0, 10);
}
