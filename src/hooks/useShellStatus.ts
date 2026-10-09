import { useSyncExternalStore } from "react";
import type { DisplayCurrency } from "@/lib/money";

/** Resumo exibido no cabeçalho e na barra de estado. Só apresentação: as telas publicam aqui. */
export type ShellStatus = {
  connection: "live" | "connecting" | "reconnecting" | "offline" | null;
  balance: number | null;
  currency: DisplayCurrency;
  todayPnl: number | null;
  active: number | null;
  hitRate: number | null;
  regime: string | null;
  nextCycleAt: number | null;
};

const EMPTY: ShellStatus = {
  connection: null,
  balance: null,
  currency: "BRL",
  todayPnl: null,
  active: null,
  hitRate: null,
  regime: null,
  nextCycleAt: null,
};

let state: ShellStatus = EMPTY;
const listeners = new Set<() => void>();

export function publishShellStatus(patch: Partial<ShellStatus>) {
  let changed = false;
  for (const k of Object.keys(patch) as (keyof ShellStatus)[]) {
    if (state[k] !== patch[k]) changed = true;
  }
  if (!changed) return;
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useShellStatus() {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}
