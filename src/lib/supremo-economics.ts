/**
 * Economia da aposta Supremo — lógica pura (sem rede, sem relógio).
 * Tudo em fração: 0,0035 = 0,35%. O ponto de equilíbrio SEMPRE sai da
 * combinação alvo/stop + taxa; nunca de uma constante fixa.
 */
import { betVariation, type Bet } from "@/hooks/useBets";
import { FEE_ROUND_TRIP_PCT } from "./scalp";
import { wilsonInterval } from "./metrics";
import { round2, toUsdt, type FxQuote } from "./fx-totals";

export type Combinacao = { alvoBruto: number; stopBruto: number; taxaIdaVolta: number };

export type Economia = {
  ganhoLiquido: number;
  perdaLiquida: number;
  /** Quantas vitórias pagam 1 derrota. */
  payoff: number | null;
  /** Acerto necessário para empatar. */
  breakEven: number | null;
  /** Chance de bater o alvo antes do stop num passeio aleatório. */
  baselineAleatorio: number | null;
};

export function economiaDaCombinacao({ alvoBruto, stopBruto, taxaIdaVolta }: Combinacao): Economia {
  const ganhoLiquido = alvoBruto - taxaIdaVolta;
  const perdaLiquida = stopBruto + taxaIdaVolta;
  const soma = ganhoLiquido + perdaLiquida;
  return {
    ganhoLiquido,
    perdaLiquida,
    payoff: ganhoLiquido > 0 ? perdaLiquida / ganhoLiquido : null,
    breakEven: ganhoLiquido > 0 && soma > 0 ? perdaLiquida / soma : ganhoLiquido <= 0 ? 1 : null,
    baselineAleatorio: stopBruto + alvoBruto > 0 ? stopBruto / (stopBruto + alvoBruto) : null,
  };
}

/** Ponto de equilíbrio de um plano gatilho/alvo/stop (com a taxa padrão). */
export function breakEvenDoPlano(plan: { trigger: number; target: number; stop: number }, taxa = FEE_ROUND_TRIP_PCT): number {
  const c = combinacaoDoPlano(plan, taxa);
  return economiaDaCombinacao(c).breakEven ?? 1;
}

export function combinacaoDoPlano(plan: { trigger: number; target: number; stop: number }, taxa = FEE_ROUND_TRIP_PCT): Combinacao {
  return {
    alvoBruto: plan.trigger > 0 ? plan.target / plan.trigger - 1 : 0,
    stopBruto: plan.stop > 0 ? plan.trigger / plan.stop - 1 : 0,
    taxaIdaVolta: taxa,
  };
}

const num = (s: string) => Number(s.replace(",", ".")) / 100;

/** Lê o rótulo gravado ("alvo +0,35% / stop −0,65%"). */
export function parseComboLabel(label: string | undefined | null): { alvoBruto: number; stopBruto: number } | null {
  if (!label) return null;
  const m = /alvo \+([\d.,]+)%\s*\/\s*stop [−-]([\d.,]+)%/.exec(label);
  if (!m) return null;
  const alvoBruto = num(m[1]!), stopBruto = num(m[2]!);
  return alvoBruto > 0 && stopBruto > 0 ? { alvoBruto, stopBruto } : null;
}

/** Combinação da aposta: a gravada; para apostas antigas, derivada de alvo/stop/gatilho. */
export function combinacaoDaAposta(
  b: Pick<Bet, "combo" | "target" | "stop" | "triggerPrice">,
  taxa = FEE_ROUND_TRIP_PCT,
): Combinacao {
  const p = parseComboLabel(b.combo);
  if (p) return { ...p, taxaIdaVolta: taxa };
  return combinacaoDoPlano({ trigger: b.triggerPrice, target: b.target, stop: b.stop }, taxa);
}

export function fmtPct(v: number | null | undefined, d = 2): string {
  if (v == null || !isFinite(v)) return "—";
  return `${(v * 100).toFixed(d).replace(".", ",")}%`;
}
const sign = (v: number) => (v >= 0 ? "+" : "−");
const fmtSigned = (v: number, d = 2) => `${sign(v)}${fmtPct(Math.abs(v), d)}`;

/** Texto do desfecho no cartão, gerado da combinação da própria aposta. */
export function rotuloDesfecho(b: Pick<Bet, "combo" | "target" | "stop" | "triggerPrice">, status: "win" | "loss"): string {
  const c = combinacaoDaAposta(b);
  const e = economiaDaCombinacao(c);
  return status === "win"
    ? `acertou +${fmtPct(c.alvoBruto)} bruto · ${fmtSigned(e.ganhoLiquido)} líquido`
    : `atingiu o limite de perda −${fmtPct(c.stopBruto)} bruto · −${fmtPct(e.perdaLiquida)} líquido`;
}

/** Ponto de equilíbrio médio das apostas resolvidas; sem nenhuma, o da combinação de referência. */
export function breakEvenDasApostas(bets: readonly Pick<Bet, "status" | "combo" | "target" | "stop" | "triggerPrice">[], ref: Combinacao): number {
  const xs = bets
    .filter((b) => b.status === "win" || b.status === "loss")
    .map((b) => economiaDaCombinacao(combinacaoDaAposta(b, ref.taxaIdaVolta)).breakEven)
    .filter((v): v is number => v != null);
  if (xs.length) return xs.reduce((a, v) => a + v, 0) / xs.length;
  return economiaDaCombinacao(ref).breakEven ?? 1;
}

// ===== Painel "Economia da aposta" =====
export type ResumoEconomia = {
  resolvidas: number;
  ganhas: number;
  perdidas: number;
  ganhoLiquidoMedio: number;
  perdaLiquidaMedia: number;
  payoff: number | null;
  breakEven: number;
  baseline: number | null;
  taxa: number | null;
  wilson: { low: number; high: number } | null;
  vantagem: number | null;
  /** Expectativa líquida por aposta resolvida (fração). */
  expectativaPct: number | null;
  /** Expectativa líquida por aposta resolvida (USDT). */
  expectativaUsdt: number | null;
  lucroUsdt: number;
  /** Vitórias médias necessárias para zerar o prejuízo (null sem prejuízo). */
  vitoriasParaRecuperar: number | null;
  abaixoDoAcaso: boolean;
  leitura: string;
};

export function resumoEconomia(
  bets: readonly Bet[],
  ref: Combinacao,
  fx: FxQuote | null | undefined,
  now: number,
): ResumoEconomia {
  const res = bets.filter((b) => b.status === "win" || b.status === "loss");
  const combos = res.map((b) => economiaDaCombinacao(combinacaoDaAposta(b, ref.taxaIdaVolta)));
  const cBase = res.map((b) => combinacaoDaAposta(b, ref.taxaIdaVolta));
  const eRef = economiaDaCombinacao(ref);
  const avg = (xs: number[], d: number) => (xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : d);
  const ganhoLiquidoMedio = avg(combos.map((e) => e.ganhoLiquido), eRef.ganhoLiquido);
  const perdaLiquidaMedia = avg(combos.map((e) => e.perdaLiquida), eRef.perdaLiquida);
  const alvoMedio = avg(cBase.map((c) => c.alvoBruto), ref.alvoBruto);
  const stopMedio = avg(cBase.map((c) => c.stopBruto), ref.stopBruto);
  const media = economiaDaCombinacao({ alvoBruto: alvoMedio, stopBruto: stopMedio, taxaIdaVolta: ref.taxaIdaVolta });
  const ganhas = res.filter((b) => b.status === "win").length;
  const perdidas = res.length - ganhas;
  const taxa = res.length ? ganhas / res.length : null;
  const wilson = wilsonInterval(ganhas, res.length);
  const breakEven = media.breakEven ?? 1;
  const baseline = media.baselineAleatorio;
  let lucro = 0, ganhoUsdt = 0, nGanho = 0;
  for (const b of res) {
    const v = toUsdt(b.stake * b.leverage * netPctOf(b), b.stakeCurrency ?? "USDT", fx, now);
    if (!v.ok) continue;
    lucro += v.usdt;
    if (b.status === "win") { ganhoUsdt += v.usdt; nGanho++; }
  }
  const expectativaPct = taxa == null ? null : taxa * ganhoLiquidoMedio - (1 - taxa) * perdaLiquidaMedia;
  const winUsdt = nGanho ? ganhoUsdt / nGanho : null;
  const vitoriasParaRecuperar = lucro < 0 && winUsdt && winUsdt > 0 ? Math.ceil(-lucro / winUsdt) : null;
  const vantagem = taxa != null && baseline != null ? taxa - baseline : null;
  const abaixoDoAcaso = vantagem != null && vantagem < 0;
  const leitura =
    taxa == null
      ? `Com esta combinação é preciso acertar ${fmtPct(breakEven, 0)}; ainda não há aposta resolvida.`
      : `Com esta combinação é preciso acertar ${fmtPct(breakEven, 0)}; o acerto atual é ${fmtPct(taxa, 0)} (IC ${fmtPct(wilson?.low ?? null, 0)}–${fmtPct(wilson?.high ?? null, 0)}).`;
  return {
    resolvidas: res.length,
    ganhas,
    perdidas,
    ganhoLiquidoMedio,
    perdaLiquidaMedia,
    payoff: media.payoff,
    breakEven,
    baseline,
    taxa,
    wilson,
    vantagem,
    expectativaPct,
    expectativaUsdt: res.length ? round2(lucro / res.length) : null,
    lucroUsdt: round2(lucro),
    vitoriasParaRecuperar,
    abaixoDoAcaso,
    leitura,
  };
}

/** Variação líquida gravada (mesma regra de betVariation para apostas resolvidas). */
function netPctOf(b: Bet): number {
  return betVariation(b, null);
}

/** "1 derrota = 5,6 vitórias". */
export function payoffText(payoff: number | null): string {
  if (payoff == null) return "—";
  return `1 derrota = ${payoff.toFixed(1).replace(".", ",")} vitórias`;
}
