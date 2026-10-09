/**
 * Um ciclo completo da trilha Supremo (sem React): busca dados, pontua as
 * moedas, escolhe a melhor e devolve a aposta a registrar. Roda no navegador
 * (hook useSupremoAuto) e no servidor (rodada automática a cada minuto).
 */
import { fetchPairs } from "@/lib/binance";
import type { Candle } from "@/lib/replay";
import { convertMoney } from "@/lib/money";
import { BAND_PCT, HOUR_MS, MIN_REPETICOES, analyzeWindow, liveBlocks, planBet, type LiveBlock } from "@/lib/supremo";
import { getClosedHour, getCurrentHour, getMinuteCandles24h, mapSettled } from "@/lib/supremo-data";
import type { Bankroll } from "@/hooks/useBankroll";
import type { Bet } from "@/hooks/useBets";
import { breakEvenAtivo, readActiveCombo } from "@/lib/supremo-combo";
import { comboLabel, planCombo } from "@/lib/target-stop-lab";
import { applyTrauma, readTrauma, writeTrauma } from "@/lib/supremo-trauma";
import { appendAudit, exposureBlock, exposureMotivo, newId, readExposure, selectCoin, type SelectionRow } from "@/lib/supremo-live";
import { scoreRows, type ScoredRow } from "@/hooks/supremoScoring";
import { changeOver, readRegime, regimeBlock, type RegimeReading } from "@/lib/market-regime";
import { coinPenalty, writePenaltySnapshot, type Penalty } from "@/lib/supremo-penalty";
import type { NewBetOpts } from "@/lib/bet-engine";

/** Bloqueios de proteção (regime) para uma moeda. */
export function protectionBlocks(
  _bets: readonly Bet[],
  row: Pick<ScoredRow, "symbol" | "hitRate" | "cycles">,
  regime: RegimeReading["regime"],
  now: number,
): { blocks: LiveBlock[]; notes: string[] } {
  const blocks: LiveBlock[] = [];
  const notes: string[] = [];
  const rb = regimeBlock(regime, { hitRate: row.hitRate, sample: row.cycles, breakEven: breakEvenAtivo() });
  if (rb) blocks.push(rb);
  void now;
  return { blocks, notes };
}

/** Dados da aposta Supremo a partir de uma candidata pontuada. */
export function betOptsFromRow(
  row: ScoredRow,
  quote: string,
  bankroll: Bankroll,
  usdtBrl: number | null,
  regime: string | undefined,
): (NewBetOpts & { symbol: string; combo: string }) | null {
  if (row.price == null) return null;
  const combo = readActiveCombo();
  const label = comboLabel(combo.targetPct, combo.stopPct, combo.mode);
  const base = planBet(row.analysis, row.price);
  if (!base && !row.plan) return null;
  const plan = row.plan ?? planCombo(base!.target, combo.targetPct, combo.stopPct, combo.mode);
  return {
    symbol: row.symbol,
    quote,
    priceNow: row.price,
    triggerPrice: plan.trigger,
    target: plan.target,
    stop: plan.stop,
    hitRate: row.report?.principal.taxaAcerto ?? 0,
    sampleSize: row.analysis.index,
    supremoMeta: row.report
      ? { score: row.report.pontuacao, stars: row.report.estrelas, hitRate: row.report.principal.taxaAcerto, cycles: row.cycles ?? 0 }
      : undefined,
    starsAtCreate: row.report?.estrelas,
    scoreAtCreate: row.report?.pontuacao,
    stake: bankroll.stake,
    leverage: bankroll.leverage,
    stakeCurrency: bankroll.currency,
    displayCurrency: bankroll.currency,
    fxAtCreate: convertMoney(1, quote, bankroll.currency, usdtBrl) ?? undefined,
    combo: label,
    regimeAtCreate: regime,
  };
}

export type CycleResult = {
  scored: ScoredRow[];
  nextPick: string | null;
  regime: RegimeReading;
  /** Motivo quando nenhuma moeda foi liberada. */
  note: string | null;
  bet: (NewBetOpts & { symbol: string; combo: string }) | null;
  chosenRow: ScoredRow | null;
};

export async function runSupremoCycle(opts: {
  bets: readonly Bet[];
  bankroll: Bankroll;
  usdtBrl: number | null;
  livePrices?: Map<string, number> | undefined;
  place: boolean;
}): Promise<CycleResult> {
  const { bankroll, livePrices } = opts;
  const pairs = await fetchPairs();
  const t = Date.now();
  const curStart = Math.floor(t / HOUR_MS) * HOUR_MS;
  const results = await mapSettled(
    pairs,
    async (p) => {
      const prev: Candle[] = await getClosedHour(p.symbol, curStart - HOUR_MS);
      const cur: Candle[] = await getCurrentHour(p.symbol, curStart, Date.now());
      return { prev, cur, fetchedAt: Date.now() };
    },
    () => {},
  );
  const traumaMap = readTrauma();
  const quoteOf = new Map(pairs.map((p) => [p.symbol, p.quote]));
  const rows = pairs.flatMap((p, i) => {
    const r = results[i];
    if (!r || !r.ok) return [];
    const from = r.value.fetchedAt - HOUR_MS;
    const window = [...r.value.prev, ...r.value.cur].filter((k) => k.time >= from);
    const analysis = analyzeWindow(window, from, HOUR_MS, BAND_PCT);
    const price = livePrices?.get(p.symbol) ?? analysis.lastClose;
    const blocks =
      price != null
        ? liveBlocks({ analysis, candles: window, fetchedAt: r.value.fetchedAt, price, minRep: MIN_REPETICOES })
        : (["dados-velhos"] as const).slice();
    const tr = applyTrauma(traumaMap, { symbol: p.symbol, candles: window, now: r.value.fetchedAt, coverage: analysis.coverage, blocks });
    const rise5m = changeOver(window, 5 * 60_000, r.value.fetchedAt);
    const ch15 = changeOver(window, 15 * 60_000, r.value.fetchedAt);
    const row: SelectionRow & { quote: string; analysis: ReturnType<typeof analyzeWindow>; rise5m: number | null; ch15: number | null } =
      { symbol: p.symbol, quote: p.quote, analysis, price, blocks: tr.blocks, rise5m, ch15 } as never;
    return [row];
  });

  writeTrauma(traumaMap);
  const [btc, eth] = await Promise.all(
    ["BTCUSDT", "ETHUSDT"].map((s) => getMinuteCandles24h(s, Date.now()).catch(() => [] as Candle[])),
  );
  const reg = readRegime({ btc: btc!, eth: eth!, universe15: rows.map((r) => r.ch15), now: Date.now() });
  const combo = readActiveCombo();
  const label = comboLabel(combo.targetPct, combo.stopPct, combo.mode);
  const exposure = readExposure();
  const scoredRaw = await scoreRows(rows, combo, Date.now());
  const nowP = Date.now();
  const penSnap: Record<string, Penalty> = {};
  const scoredRows = scoredRaw.map((r) => {
    const extra = protectionBlocks(opts.bets, r, reg.regime, nowP).blocks;
    const rise = rows.find((x) => x.symbol === r.symbol)?.rise5m;
    if (rise != null && rise > 0.003) extra.push("perseguindo-alta");
    const pen = coinPenalty(opts.bets as Bet[], r.symbol, nowP);
    if (pen) penSnap[r.symbol] = pen;
    const blocks = [...r.blocks, ...extra.filter((b) => !r.blocks.includes(b))];
    return { ...r, blocks };
  });
  writePenaltySnapshot(penSnap);
  const { chosen, coins } = selectCoin(scoredRows, (s) => exposureBlock(opts.bets as Bet[], s, label, exposure, nowP));
  const scored = scoredRows.filter((r) => r.report).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const base = { scored, nextPick: chosen?.symbol ?? null, regime: reg };
  if (!opts.place) return { ...base, note: null, bet: null, chosenRow: null };
  const cycleId = newId();
  if (!chosen) {
    const counts = new Map<string, number>();
    for (const c of coins) {
      for (const b of c.blocks) counts.set(b, (counts.get(b) ?? 0) + 1);
      if (c.exposure) { const k = exposureMotivo(c.exposure); counts.set(k, (counts.get(k) ?? 0) + 1); }
    }
    const summary = [...counts.entries()].map(([k, n]) => `${k} (${n})`).join(", ");
    const note = `Nenhuma moeda liberada no último ciclo${summary ? ` — ${summary}` : ""}.`;
    appendAudit({ id: cycleId, at: t, chosen: null, note, coins, regime: reg.regime });
    return { ...base, note, bet: null, chosenRow: null };
  }
  const row = scoredRows.find((r) => r.symbol === chosen.symbol)!;
  appendAudit({ id: cycleId, at: t, chosen: row.symbol, note: null, coins, regime: reg.regime });
  const bet = betOptsFromRow(row, quoteOf.get(row.symbol) ?? "USDT", bankroll, opts.usdtBrl, reg.regime);
  return { ...base, note: null, bet, chosenRow: row };
}
