import { FEE_ROUND_TRIP_PCT } from "./scalp";
import { economiaDaCombinacao, type Combinacao } from "./supremo-economics";
import { CURRENT_STOP_PCT, CURRENT_TARGET_PCT, type LabMode } from "./target-stop-lab";

/** Combinação de alvo/stop usada pela trilha Supremo nas próximas apostas. */
export type ActiveCombo = { targetPct: number; stopPct: number; mode: LabMode };

const KEY = "supremo-active-combo-v1";
export const DEFAULT_COMBO: ActiveCombo = { targetPct: CURRENT_TARGET_PCT, stopPct: CURRENT_STOP_PCT, mode: "percentual" };

export function readActiveCombo(): ActiveCombo {
  if (typeof localStorage === "undefined") return DEFAULT_COMBO;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && v.targetPct > 0 && v.stopPct > 0) return { targetPct: v.targetPct, stopPct: v.stopPct, mode: v.mode === "fixo-ima" ? "fixo-ima" : "percentual" };
  } catch {}
  return DEFAULT_COMBO;
}

export function writeActiveCombo(c: ActiveCombo | null) {
  if (c) localStorage.setItem(KEY, JSON.stringify(c));
  else localStorage.removeItem(KEY);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("supremo-combo"));
}

/** Combinação ativa como entrada da economia (taxa de ida e volta padrão). */
export function combinacaoAtiva(c: ActiveCombo = readActiveCombo(), taxa = FEE_ROUND_TRIP_PCT): Combinacao {
  return { alvoBruto: c.targetPct, stopBruto: c.stopPct, taxaIdaVolta: taxa };
}

/** Ponto de equilíbrio da combinação ativa. */
export function breakEvenAtivo(c: ActiveCombo = readActiveCombo()): number {
  return economiaDaCombinacao(combinacaoAtiva(c)).breakEven ?? 1;
}
