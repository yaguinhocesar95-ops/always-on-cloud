/**
 * Trauma da moeda — memória persistente de uma queda forte (paper trading).
 *
 * Gatilho: exatamente o critério de `perigo` (queda dos últimos 5 s maior que
 * 3 desvios-padrão das variações de 5 s da janela, relativo à própria moeda).
 * `perigo` é o bloqueio imediato; `trauma` permanece até a moeda cumprir as
 * condições técnicas de reabilitação. Isso NÃO afirma que a queda terminou —
 * apenas que o preço atendeu aos critérios abaixo.
 *
 * Nada aqui altera bandIndex, ímã, planBet, simulateBet, custos ou resolução.
 */
import type { Candle } from "./replay";
import { dangerStats, SUPREMO_MAX_AGE_MS, SUPREMO_MIN_COVERAGE, type LiveBlock } from "./supremo";

/** Tempo mínimo sem nova mínima. */
export const TRAUMA_STABLE_MS = 60_000;
/** Amplitude máxima (high-low / low) no período de estabilidade. */
export const TRAUMA_MAX_RANGE_PCT = 0.5;
/** Cooldown adicional após a estabilização. */
export const TRAUMA_COOLDOWN_MS = 5 * 60_000;

export type TraumaPhase = "trauma" | "cooldown" | "liberada";

export type TraumaState = {
  symbol: string;
  active: boolean;
  phase: TraumaPhase;
  triggeredAt?: number | undefined;
  triggerPrice?: number | undefined;
  lowestPrice?: number | undefined;
  /** Horário da vela que marcou a menor mínima. */
  lowestAt?: number | undefined;
  reason?: string | undefined;
  recoveredAt?: number | undefined;
  stableSince?: number | undefined;
  /** Último motivo pelo qual a reabilitação não avançou. */
  waiting?: string | undefined;
  updatedAt?: number | undefined;
};

export type TraumaInput = {
  symbol: string;
  candles: readonly Candle[];
  /** Momento da leitura (usado como "agora"). */
  now: number;
  coverage: number;
  /** Bloqueios normais da moeda (sem "trauma"). */
  blocks: readonly LiveBlock[];
};

const fmt = (v: number, d = 3) => `${(v * 100).toFixed(d).replace(".", ",")}%`;

function triggerReason(s: NonNullable<ReturnType<typeof dangerStats>>): string {
  return `queda de ${fmt(s.last)} em 5 s · desvio-padrão ${fmt(s.sd)} · limite ${fmt(s.limit)} (3σ) ultrapassado`;
}

function restart(prev: TraumaState, why: string, now: number): TraumaState {
  return { ...prev, active: true, phase: "trauma", recoveredAt: undefined, waiting: why, updatedAt: now };
}

/** Avança o estado de trauma de uma moeda. Função pura. */
export function updateTrauma(prev: TraumaState | undefined, input: TraumaInput): TraumaState {
  const { symbol, candles, now, coverage, blocks } = input;
  const ds = dangerStats(candles);
  const last = candles[candles.length - 1];

  // Gatilho (ou reativação): perigo ativo.
  if (ds?.danger && last) {
    const continuing = prev?.active && prev.phase === "trauma";
    const low = Math.min(last.low, continuing ? (prev!.lowestPrice ?? Infinity) : Infinity);
    return {
      symbol,
      active: true,
      phase: "trauma",
      triggeredAt: continuing ? prev!.triggeredAt : now,
      triggerPrice: continuing ? prev!.triggerPrice : last.close,
      lowestPrice: low,
      lowestAt: low === last.low ? last.time : prev?.lowestAt,
      stableSince: undefined,
      recoveredAt: undefined,
      reason: triggerReason(ds),
      waiting: "perigo ainda ativo",
      updatedAt: now,
    };
  }

  if (!prev || !prev.active) {
    return prev ? { ...prev, updatedAt: now } : { symbol, active: false, phase: "liberada", updatedAt: now };
  }

  // Atualiza a menor mínima desde o gatilho.
  let s: TraumaState = { ...prev, updatedAt: now };
  for (const c of candles) {
    if (c.time < (s.triggeredAt ?? 0) - 5_000) continue;
    if (s.lowestPrice == null || c.low < s.lowestPrice) {
      s.lowestPrice = c.low;
      s.lowestAt = c.time;
    }
  }
  s.stableSince = s.lowestAt;

  // Condições técnicas.
  const fails: string[] = [];
  if (!last || now - (last.time + 1000) > SUPREMO_MAX_AGE_MS) fails.push("dados velhos (> 3 s)");
  if (coverage < SUPREMO_MIN_COVERAGE) fails.push("cobertura abaixo de 60%");
  const sinceLow = s.lowestAt == null ? 0 : now - s.lowestAt;
  if (sinceLow < TRAUMA_STABLE_MS)
    fails.push(`nova mínima há ${Math.floor(sinceLow / 1000)} s (precisa ${TRAUMA_STABLE_MS / 1000} s)`);
  const tail = candles.filter((c) => c.time >= now - TRAUMA_STABLE_MS);
  if (tail.length) {
    const hi = Math.max(...tail.map((c) => c.high));
    const lo = Math.min(...tail.map((c) => c.low));
    const range = lo > 0 ? ((hi - lo) / lo) * 100 : Infinity;
    if (range > TRAUMA_MAX_RANGE_PCT)
      fails.push(`amplitude ${range.toFixed(2).replace(".", ",")}% (máx. 0,50%)`);
  } else fails.push("sem velas no período de estabilidade");

  if (fails.length) return restart(s, fails.join("; "), now);

  if (s.phase === "trauma") {
    return { ...s, phase: "cooldown", recoveredAt: now, waiting: "estabilizada; cumprindo cooldown de 5 min" };
  }

  // Cooldown.
  const elapsed = now - (s.recoveredAt ?? now);
  if (elapsed < TRAUMA_COOLDOWN_MS) {
    const left = Math.ceil((TRAUMA_COOLDOWN_MS - elapsed) / 1000);
    return { ...s, waiting: `cooldown: faltam ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` };
  }
  // Reavaliação final: precisa passar por todos os bloqueios normais.
  const other = blocks.filter((b) => b !== "trauma");
  if (other.length) return restart(s, `bloqueios normais na reavaliação: ${other.join(", ")}`, now);
  return { ...s, active: false, phase: "liberada", waiting: undefined };
}

export function traumaText(s: TraumaState | undefined): string | null {
  if (!s?.active) return null;
  const fase = s.phase === "cooldown" ? "cooldown" : "observação";
  return `trauma (${fase}): ${s.reason ?? "queda forte"}${s.waiting ? ` — aguardando: ${s.waiting}` : ""}. Condição técnica, não garantia de que a queda terminou.`;
}

const KEY = "supremo-trauma-v1";

export function readTrauma(): Record<string, TraumaState> {
  if (typeof localStorage === "undefined") return {};
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function writeTrauma(m: Record<string, TraumaState>) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* storage cheio */
  }
}

/**
 * Aplica o trauma a uma linha: atualiza/persiste o estado e devolve os
 * bloqueios com "trauma" acrescentado quando ativo.
 */
export function applyTrauma(
  map: Record<string, TraumaState>,
  input: TraumaInput,
): { blocks: LiveBlock[]; state: TraumaState } {
  const state = updateTrauma(map[input.symbol], input);
  map[input.symbol] = state;
  return { blocks: state.active ? [...input.blocks, "trauma"] : [...input.blocks], state };
}
