/**
 * Ranking informativo entre os pares monitorados.
 *
 * REGRA DURA: aqui não existe métrica nova, previsão nova nem gatilho novo.
 * Este módulo só AGREGA, de forma transparente, números que o motor
 * (`scalp.ts`), os filtros (`filters.ts`), a qualidade do feed
 * (`feed-quality.ts`), as métricas do ímã (`magnet-metrics.ts`) e as métricas
 * históricas (`metrics.ts`) já calcularam para cada par.
 *
 * O resultado responde a uma única pergunta de apoio à decisão: dos pares
 * monitorados, qual está agora com o cenário mais limpo para tentar uma
 * validação? A entrada continua sendo decidida exclusivamente pelo motor.
 */

import { MIN_COVERAGE } from "./feed-quality";
import { STABLE_MAX_DRIFT_PCT, STABLE_MIN_CONCENTRATION, STABLE_MIN_GAP } from "./magnet-metrics";
import { MIN_SIGNIFICANT_SAMPLE, type Metrics } from "./metrics";
import type { EngineMode, ScalpEngine } from "./scalp";

/** Situação do par agora, na linguagem do próprio motor. */
export type PairSignalState = "ativo" | "aquecendo" | "aguardando" | "bloqueado" | "sem-dado";

export const SIGNAL_LABEL: Record<PairSignalState, string> = {
  ativo: "sinal ativo",
  aquecendo: "carregando histórico",
  aguardando: "sem gatilho ainda",
  bloqueado: "bloqueado",
  "sem-dado": "sem leitura",
};

/**
 * Motivos que significam "a geometria do gatilho ainda não existe" — ou seja,
 * o par está apenas sendo observado, não reprovado. Qualquer outro motivo
 * (feed ruim, queda perigosa, filtro reprovado, tendência, correlação) é
 * bloqueio de verdade.
 */
const WAITING_REASONS = new Set(["below-entry", "flat", "no-cluster"]);


/** Um ingrediente do ranking, sempre com o número medido que o originou. */
export type RankComponent = {
  id: "sinal" | "filtros" | "feed" | "ima" | "historico";
  label: string;
  /** Peso relativo declarado (a soma dos pesos usados é normalizada). */
  weight: number;
  /** 0..1, ou null quando o componente não é mensurável agora. */
  value: number | null;
  /** O número medido, já formatado em pt-BR. */
  detail: string;
};

export type PairRank = {
  symbol: string;
  base: string;
  quote: string;
  /** 0..1 — média ponderada dos componentes mensuráveis. null = sem base. */
  score: number | null;
  /** Fração do peso total que pôde ser medida (transparência da nota). */
  measuredWeight: number;
  /** Modo do motor que gerou esta linha (baseline ou agrupamento estável). */
  mode: EngineMode;
  state: PairSignalState;
  /** Filtros da Fase 4 passando / mensuráveis / não mensuráveis agora. */
  filtersPass: number;
  filtersMeasurable: number;
  filtersUnavailable: number;
  /** Motivos legíveis de bloqueio (filtros + motivos do motor). */
  blocked: string[];
  components: RankComponent[];
  /** Operações resolvidas do par usadas no componente histórico. */
  historySample: number;
};

export type PairRankInput = {
  symbol: string;
  base: string;
  quote: string;
  /** Resultado do motor para este par (mesmo motor da tela principal). */
  engine: ScalpEngine | null;
  /** Métricas históricas já calculadas para este par (ou null). */
  history: Metrics | null;
};

const WEIGHTS = {
  sinal: 0.3,
  filtros: 0.25,
  ima: 0.2,
  feed: 0.15,
  historico: 0.1,
} as const;

/**
 * No agrupamento estável o ranking aponta o par que melhor pontua em
 * "Filtros e confiança do preço-alvo": os filtros viram o ingrediente
 * dominante da nota; os demais seguem como desempate.
 */
const WEIGHTS_STABLE = {
  sinal: 0.2,
  filtros: 0.5,
  ima: 0.15,
  feed: 0.1,
  historico: 0.05,
} as const;

const weightsFor = (mode: EngineMode | undefined) =>
  mode === "stable-cluster" ? WEIGHTS_STABLE : WEIGHTS;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d).replace(".", ",")}%`;

function signalComponent(engine: ScalpEngine | null): RankComponent {
  if (engine == null || engine.ticks === 0) {
    return {
      id: "sinal",
      label: "sinal do motor",
      weight: WEIGHTS.sinal,
      value: null,
      detail: "sem leitura da janela",
    };
  }
  if (engine.ready) {
    return {
      id: "sinal",
      label: "sinal do motor",
      weight: WEIGHTS.sinal,
      value: 1,
      detail: "gatilho válido, aguardando a queda até a entrada",
    };
  }
  if (engine.readyBaseline) {
    return {
      id: "sinal",
      label: "sinal do motor",
      weight: WEIGHTS.sinal,
      value: 0.55,
      detail: "gatilho do baseline válido, derrubado apenas pelos filtros",
    };
  }
  if (engine.blockReasons.includes("warmup")) {
    return {
      id: "sinal",
      label: "sinal do motor",
      weight: WEIGHTS.sinal,
      value: 0,
      detail: `carregando o histórico da janela (${Math.round(engine.warmupPct * 100)}%)`,
    };
  }
  return {
    id: "sinal",
    label: "sinal do motor",
    weight: WEIGHTS.sinal,
    value: 0,
    detail: `sem gatilho: ${engine.blockReasons.join(", ")}`,
  };
}

function filtersComponent(engine: ScalpEngine | null): {
  component: RankComponent;
  pass: number;
  measurable: number;
  unavailable: number;
  blocked: string[];
} {
  const filters = engine?.filters ?? [];
  const pass = filters.filter((f) => f.status === "pass").length;
  const unavailable = filters.filter((f) => f.status === "unavailable").length;
  const measurable = filters.length - unavailable;
  const blocked = filters.filter((f) => f.status === "block").map((f) => f.label);
  const value = measurable > 0 ? pass / measurable : null;
  return {
    component: {
      id: "filtros",
      label: "filtros passando",
      weight: WEIGHTS.filtros,
      value,
      detail:
        filters.length === 0
          ? "filtros ainda não avaliados"
          : `${pass} de ${measurable} mensuráveis${unavailable > 0 ? ` · ${unavailable} não mensurável(is)` : ""}`,
    },
    pass,
    measurable,
    unavailable,
    blocked,
  };
}

function feedComponent(engine: ScalpEngine | null): RankComponent {
  const q = engine?.quality ?? null;
  if (q == null || q.level === "empty") {
    return {
      id: "feed",
      label: "qualidade e idade do feed",
      weight: WEIGHTS.feed,
      value: null,
      detail: "sem leitura",
    };
  }
  const coverageScore = clamp01((q.coverage - MIN_COVERAGE) / (1 - MIN_COVERAGE));
  const value = q.level === "healthy" ? coverageScore : 0;
  const age = q.ageMs == null ? "—" : `${(q.ageMs / 1000).toFixed(1).replace(".", ",")} s`;
  return {
    id: "feed",
    label: "qualidade e idade do feed",
    weight: WEIGHTS.feed,
    value,
    detail: `cobertura ${pct(q.coverage, 0)} · ${q.missingSeconds} s sem leitura · idade ${age}`,
  };
}

function magnetComponent(engine: ScalpEngine | null): RankComponent {
  const m = engine?.metrics ?? null;
  if (m == null) {
    return {
      id: "ima",
      label: "concentração e estabilidade do ímã",
      weight: WEIGHTS.ima,
      value: null,
      detail: "sem caixa vencedora",
    };
  }
  const concentration = clamp01(m.concentration / (STABLE_MIN_CONCENTRATION * 2));
  const gap = clamp01(m.gapToSecond / (STABLE_MIN_GAP * 2));
  const drift =
    m.stabilityDriftPct == null ? null : clamp01(1 - m.stabilityDriftPct / STABLE_MAX_DRIFT_PCT);
  const parts = drift == null ? [concentration, gap] : [concentration, gap, drift];
  const value = parts.reduce((a, b) => a + b, 0) / parts.length;
  return {
    id: "ima",
    label: "concentração e estabilidade do ímã",
    weight: WEIGHTS.ima,
    value,
    detail: `concentração ${pct(m.concentration, 0)} · vantagem ${(m.gapToSecond * 100).toFixed(0)} p.p. · deriva ${
      m.stabilityDriftPct == null ? "—" : pct(m.stabilityDriftPct / 100, 2)
    }${m.edgeSensitive ? " · sensível à borda" : ""}`,
  };
}

function historyComponent(history: Metrics | null): RankComponent {
  const sample = history?.sample ?? 0;
  if (history == null || sample < MIN_SIGNIFICANT_SAMPLE || history.expectancy == null) {
    return {
      id: "historico",
      label: "histórico do par (acerto e expectativa líquida)",
      weight: WEIGHTS.historico,
      value: null,
      detail:
        sample === 0
          ? "nenhuma operação resolvida deste par"
          : `amostra de ${sample} operações — pequena demais para pesar (mínimo ${MIN_SIGNIFICANT_SAMPLE})`,
    };
  }
  // Expectativa líquida de +0,35% (o alvo do modelo) vale nota máxima; 0 vale
  // metade; expectativa negativa puxa para baixo. Nada é previsto aqui.
  const value = clamp01(0.5 + history.expectancy / 0.0035 / 2);
  const hit = history.hitRate == null ? "—" : pct(history.hitRate, 1);
  const be = history.breakevenHitRate == null ? "—" : pct(history.breakevenHitRate, 1);
  return {
    id: "historico",
    label: "histórico do par (acerto e expectativa líquida)",
    weight: WEIGHTS.historico,
    value,
    detail: `expectativa ${pct(history.expectancy, 3)} · acerto ${hit} (empate em ${be}) · ${sample} operações`,
  };
}

function stateOf(engine: ScalpEngine | null): PairSignalState {
  if (engine == null || engine.ticks === 0) return "sem-dado";
  if (engine.ready) return "ativo";
  if (engine.blockReasons.includes("warmup")) return "aquecendo";
  // Só é "bloqueado" quando algo reprova o par. Se os únicos motivos são a
  // ausência da geometria do gatilho, o par está apenas em observação.
  if (engine.blockReasons.every((r) => WAITING_REASONS.has(r))) return "aguardando";
  return "bloqueado";
}


/** Agrega os números já calculados de UM par em uma nota comparável. */
export function rankPair(input: PairRankInput): PairRank {
  const { engine, history } = input;
  const sinal = signalComponent(engine);
  const filtros = filtersComponent(engine);
  const feed = feedComponent(engine);
  const ima = magnetComponent(engine);
  const historico = historyComponent(history);

  const weights = weightsFor(engine?.mode);
  const components = [sinal, filtros.component, ima, feed, historico].map((c) => ({
    ...c,
    weight: weights[c.id],
  }));
  const used = components.filter((c) => c.value != null);
  const weightSum = used.reduce((a, c) => a + c.weight, 0);
  const totalWeight = components.reduce((a, c) => a + c.weight, 0);
  const score =
    weightSum > 0 ? used.reduce((a, c) => a + c.weight * (c.value ?? 0), 0) / weightSum : null;

  const engineBlocks = (engine?.blockReasons ?? []).filter((r) => r !== "filtro");

  return {
    symbol: input.symbol,
    base: input.base,
    quote: input.quote,
    score,
    measuredWeight: weightSum / totalWeight,
    mode: engine?.mode ?? "baseline",
    state: stateOf(engine),
    filtersPass: filtros.pass,
    filtersMeasurable: filtros.measurable,
    filtersUnavailable: filtros.unavailable,
    blocked: [...new Set([...engineBlocks, ...filtros.blocked])],
    components,
    historySample: history?.sample ?? 0,
  };
}

/**
 * Ranking dos pares monitorados, do cenário mais limpo para o mais sujo.
 * Empate é resolvido pelo símbolo, para a ordem ser estável na tela.
 */
export function rankPairs(inputs: readonly PairRankInput[]): PairRank[] {
  return inputs
    .map(rankPair)
    .sort(
      (a, b) =>
        (b.score ?? -1) - (a.score ?? -1) || a.symbol.localeCompare(b.symbol, "pt-BR"),
    );
}

/** Frase honesta sobre o topo do ranking (ou a ausência de um topo). */
export function rankingHeadline(ranked: readonly PairRank[]): string {
  const top = ranked[0];
  if (!top || top.score == null) return "Sem leitura suficiente para comparar os pares agora.";
  if (top.state === "ativo") {
    return top.mode === "stable-cluster"
      ? `${top.base}/${top.quote} pontua melhor nos filtros agora e tem gatilho válido.`
      : `${top.base}/${top.quote} está com o cenário mais limpo agora e com gatilho válido.`;
  }
  return top.mode === "stable-cluster"
    ? `Nenhum par com gatilho válido agora; ${top.base}/${top.quote} pontua melhor nos filtros no momento.`
    : `Nenhum par com gatilho válido agora; ${top.base}/${top.quote} é o cenário menos sujo no momento.`;
}
