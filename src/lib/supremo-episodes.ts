/**
 * Episódios independentes: apostas criadas com menos de 10 min de diferença
 * fazem parte do mesmo episódio (rajada). Lógica pura.
 */
import type { Bet } from "@/hooks/useBets";
import { wilsonInterval } from "./metrics";
import { betNetUsdt } from "./supremo-ranking";
import type { FxQuote } from "./fx-totals";

export const EPISODE_GAP_MS = 10 * 60_000;

export type Episode = { start: number; bets: Bet[]; lucro: number; resolvidas: number; resultado: "ganho" | "perdido" | "neutro" | "aberto" };

export function episodios(bets: readonly Bet[], fx: FxQuote | null | undefined, now: number, gap = EPISODE_GAP_MS): Episode[] {
  const sorted = [...bets].filter((b) => b.status !== "cancelled").sort((a, b) => a.createdAt - b.createdAt);
  const groups: Bet[][] = [];
  for (const b of sorted) {
    const g = groups[groups.length - 1];
    const last = g?.[g.length - 1];
    if (g && last && b.createdAt - last.createdAt < gap) g.push(b);
    else groups.push([b]);
  }
  return groups.map((g) => {
    let lucro = 0, resolvidas = 0;
    for (const b of g) {
      if (b.status !== "win" && b.status !== "loss") continue;
      resolvidas++;
      lucro += betNetUsdt(b, null, fx, now) ?? 0;
    }
    const lucroR = Math.round(lucro * 100) / 100;
    const resultado = resolvidas === 0 ? "aberto" : lucroR > 0 ? "ganho" : lucroR < 0 ? "perdido" : "neutro";
    return { start: g[0]!.createdAt, bets: g, lucro: lucroR, resolvidas, resultado };
  });
}

export function resumoEpisodios(bets: readonly Bet[], fx: FxQuote | null | undefined, now: number) {
  const eps = episodios(bets, fx, now).filter((e) => e.resultado !== "aberto");
  const ganhos = eps.filter((e) => e.resultado === "ganho").length;
  const perdidos = eps.filter((e) => e.resultado === "perdido").length;
  const neutros = eps.filter((e) => e.resultado === "neutro").length;
  const n = ganhos + perdidos;
  const apostas = eps.reduce((s, e) => s + e.resolvidas, 0);
  return {
    apostas,
    episodios: eps.length,
    ganhos,
    perdidos,
    neutros,
    taxa: n ? ganhos / n : null,
    wilson: wilsonInterval(ganhos, n),
    texto: `${apostas} apostas = ${eps.length} episódios independentes`,
  };
}
