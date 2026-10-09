/**
 * Fase 5 — métricas honestas.
 *
 * Taxa de acerto NÃO é rentabilidade. Este módulo calcula, sobre operações já
 * resolvidas, o que de fato importa: expectativa líquida por operação, acerto
 * mínimo para empatar, ganho e perda médios, fator de lucro, rebaixamento
 * máximo, pior sequência de perdas e retorno por unidade de risco.
 *
 * Tudo em FRAÇÃO (0,0035 = 0,35%). Arredondamento só na apresentação.
 */

/** Como tratar casos em que a mesma vela de 1 s tocou alvo E stop. */
export type AmbiguityPolicy = "conservadora" | "excluir" | "otimista";

export const AMBIGUITY_POLICIES: AmbiguityPolicy[] = ["conservadora", "excluir", "otimista"];

export const AMBIGUITY_POLICY_LABEL: Record<AmbiguityPolicy, string> = {
  conservadora: "conta como perda (padrão)",
  excluir: "descarta da estatística",
  otimista: "conta como ganho (só para comparação)",
};

/** Uma operação já resolvida, com os dois desfechos líquidos possíveis. */
export type ResolvedTrade = {
  id: string;
  symbol: string;
  /** Hora local (0–23) em que a operação foi criada. */
  hour: number;
  /** Versão do motor que gerou o sinal. */
  engineVersion: string;
  /** Regime de volatilidade no momento da criação. */
  regime: string;
  /** Desfecho registrado pelo robô. */
  outcome: "win" | "loss";
  /** A mesma vela de 1 s tocou alvo e stop. */
  ambiguous: boolean;
  /** Retorno líquido caso vencesse (fração). */
  netIfWin: number;
  /** Retorno líquido caso perdesse (fração, negativo). */
  netIfLoss: number;
  /** Instante da resolução (ms), usado para ordenar o rebaixamento. */
  resolvedAt: number;
};

/** Amostra abaixo disso não sustenta conclusão nenhuma. */
export const MIN_SIGNIFICANT_SAMPLE = 30;
/** Abaixo disso a amostra é apenas indicativa. */
export const WEAK_SAMPLE = 100;

export type Metrics = {
  /** Operações efetivamente usadas no cálculo (após a política de ambiguidade). */
  sample: number;
  /** Operações ambíguas encontradas, antes da política. */
  ambiguousCount: number;
  /** Operações descartadas pela política de ambiguidade. */
  excludedCount: number;
  wins: number;
  losses: number;
  /** Fração de acerto observada. Não é rentabilidade. */
  hitRate: number | null;
  /** Acerto mínimo necessário só para empatar, dado ganho e perda médios. */
  breakevenHitRate: number | null;
  /** Ganho médio das operações vencedoras (fração). */
  avgWin: number | null;
  /** Perda média das perdedoras (fração, negativa). */
  avgLoss: number | null;
  /** Expectativa líquida por operação (fração). O número que decide tudo. */
  expectancy: number | null;
  /** Soma dos ganhos ÷ soma das perdas. >1 é positivo, <1 é negativo. */
  profitFactor: number | null;
  /** Retorno acumulado composto da sequência (fração). */
  totalReturn: number;
  /** Maior rebaixamento da curva acumulada (fração, positivo). */
  maxDrawdown: number;
  /** Pior sequência de perdas consecutivas. */
  worstLosingStreak: number;
  /** Expectativa dividida pelo risco médio por operação (R). */
  returnPerRisk: number | null;
  /** Erro-padrão da expectativa — mede o quanto o número é instável. */
  expectancyStdError: number | null;
  /** Intervalo de confiança (95%) da taxa de acerto, método de Wilson. */
  hitRateCI: { low: number; high: number } | null;
  /** Amostra pequena demais para concluir. */
  lowSignificance: boolean;
  /** Texto pt-BR explicando o estado da amostra. */
  significanceNote: string;
};

export const EMPTY_METRICS: Metrics = {
  sample: 0,
  ambiguousCount: 0,
  excludedCount: 0,
  wins: 0,
  losses: 0,
  hitRate: null,
  breakevenHitRate: null,
  avgWin: null,
  avgLoss: null,
  expectancy: null,
  profitFactor: null,
  totalReturn: 0,
  maxDrawdown: 0,
  worstLosingStreak: 0,
  returnPerRisk: null,
  expectancyStdError: null,
  hitRateCI: null,
  lowSignificance: true,
  significanceNote: "Sem operações resolvidas — nada a concluir.",
};

/** Aplica a política de ambiguidade e devolve o retorno líquido realizado. */
function realizedReturn(trade: ResolvedTrade, policy: AmbiguityPolicy): number | null {
  if (!trade.ambiguous) return trade.outcome === "win" ? trade.netIfWin : trade.netIfLoss;
  if (policy === "excluir") return null;
  if (policy === "otimista") return trade.netIfWin;
  return trade.netIfLoss; // conservadora
}

/** Intervalo de Wilson (95%) — honesto com amostras pequenas. */
export function wilsonInterval(successes: number, n: number): { low: number; high: number } | null {
  if (n <= 0) return null;
  const z = 1.96;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return {
    low: Math.max(0, (center - spread) / denom),
    high: Math.min(1, (center + spread) / denom),
  };
}

function significance(sample: number): { low: boolean; note: string } {
  if (sample === 0) return { low: true, note: "Sem operações resolvidas — nada a concluir." };
  if (sample < MIN_SIGNIFICANT_SAMPLE) {
    return {
      low: true,
      note: `Amostra de ${sample} operações: pequena demais. Abaixo de ${MIN_SIGNIFICANT_SAMPLE} o resultado é ruído, não desempenho.`,
    };
  }
  if (sample < WEAK_SAMPLE) {
    return {
      low: true,
      note: `Amostra de ${sample} operações: apenas indicativa. Estabilidade razoável começa perto de ${WEAK_SAMPLE}.`,
    };
  }
  return {
    low: false,
    note: `Amostra de ${sample} operações. Ainda assim, desempenho passado não garante resultado futuro.`,
  };
}

export function computeMetrics(
  trades: readonly ResolvedTrade[],
  policy: AmbiguityPolicy = "conservadora",
): Metrics {
  const ambiguousCount = trades.filter((t) => t.ambiguous).length;

  const ordered = [...trades].sort((a, b) => a.resolvedAt - b.resolvedAt);
  const returns: number[] = [];
  const risks: number[] = [];
  let excludedCount = 0;

  for (const t of ordered) {
    const r = realizedReturn(t, policy);
    if (r == null) {
      excludedCount += 1;
      continue;
    }
    returns.push(r);
    risks.push(Math.abs(t.netIfLoss));
  }

  const sample = returns.length;
  if (sample === 0) {
    const sig = significance(0);
    return {
      ...EMPTY_METRICS,
      ambiguousCount,
      excludedCount,
      lowSignificance: sig.low,
      significanceNote: sig.note,
    };
  }

  const winReturns = returns.filter((r) => r > 0);
  const lossReturns = returns.filter((r) => r <= 0);
  const wins = winReturns.length;
  const losses = lossReturns.length;

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const avgWin = wins > 0 ? sum(winReturns) / wins : null;
  const avgLoss = losses > 0 ? sum(lossReturns) / losses : null;
  const expectancy = sum(returns) / sample;

  const grossProfit = sum(winReturns);
  const grossLoss = Math.abs(sum(lossReturns));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null;

  const breakevenHitRate =
    avgWin != null && avgWin > 0 && avgLoss != null && avgLoss < 0
      ? Math.abs(avgLoss) / (avgWin + Math.abs(avgLoss))
      : null;

  // Curva composta: cada operação rende sobre o capital acumulado.
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  let streak = 0;
  let worstLosingStreak = 0;
  for (const r of returns) {
    equity *= 1 + r;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
    if (r <= 0) {
      streak += 1;
      if (streak > worstLosingStreak) worstLosingStreak = streak;
    } else {
      streak = 0;
    }
  }

  const avgRisk = risks.length > 0 ? sum(risks) / risks.length : 0;
  const returnPerRisk = avgRisk > 0 ? expectancy / avgRisk : null;

  const variance =
    sample > 1 ? sum(returns.map((r) => (r - expectancy) ** 2)) / (sample - 1) : null;
  const expectancyStdError = variance != null ? Math.sqrt(variance / sample) : null;

  const sig = significance(sample);

  return {
    sample,
    ambiguousCount,
    excludedCount,
    wins,
    losses,
    hitRate: wins / sample,
    breakevenHitRate,
    avgWin,
    avgLoss,
    expectancy,
    profitFactor,
    totalReturn: equity - 1,
    maxDrawdown,
    worstLosingStreak,
    returnPerRisk,
    expectancyStdError,
    hitRateCI: wilsonInterval(wins, sample),
    lowSignificance: sig.low,
    significanceNote: sig.note,
  };
}

export type MetricGroup = {
  key: string;
  label: string;
  metrics: Metrics;
};

/** Agrupa as operações por uma chave e calcula métricas em cada grupo. */
export function groupMetrics(
  trades: readonly ResolvedTrade[],
  keyOf: (t: ResolvedTrade) => string,
  policy: AmbiguityPolicy = "conservadora",
  labelOf: (key: string) => string = (k) => k,
): MetricGroup[] {
  const buckets = new Map<string, ResolvedTrade[]>();
  for (const t of trades) {
    const k = keyOf(t);
    const arr = buckets.get(k);
    if (arr) arr.push(t);
    else buckets.set(k, [t]);
  }
  return [...buckets.entries()]
    .map(([key, list]) => ({ key, label: labelOf(key), metrics: computeMetrics(list, policy) }))
    .sort((a, b) => a.key.localeCompare(b.key, "pt-BR", { numeric: true }));
}

/** Formata uma fração como percentual pt-BR. */
export function fmtPct(value: number | null, digits = 2): string {
  if (value == null || !isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits).replace(".", ",")}%`;
}

/** Formata um número simples pt-BR. */
export function fmtNum(value: number | null, digits = 2): string {
  if (value == null) return "—";
  if (!isFinite(value)) return "∞";
  return value.toFixed(digits).replace(".", ",");
}
