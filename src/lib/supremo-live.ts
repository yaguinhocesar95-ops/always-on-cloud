/**
 * Validar Aposta Supremo — regras da trilha ao vivo (sem rede, sem relógio).
 *
 * Exposição, estatísticas, resultado financeiro, auditoria da seleção e
 * frescor dos preços. Nada aqui altera as regras matemáticas do motor
 * (faixas, janela, gatilho, alvo, stop) — só decide SE uma aposta pode ser
 * registrada e como os números são contados.
 */
import type { Bet } from "@/hooks/useBets";
import { betPnl } from "@/hooks/useBets";
import { correlationGroupOf } from "./correlation";
import { SUPREMO_MAX_AGE_MS, type HourAnalysis, type LiveBlock } from "./supremo";

// ===== Exposição =====
export type ExposureSettings = {
  /** Máximo de apostas ativas (aguardando gatilho + valendo) no total. */
  maxActiveTotal: number;
  /** Máximo de apostas ativas por moeda. */
  maxActivePerCoin: number;
  /** Permite nova aposta com a mesma moeda e combinação enquanto a anterior está ativa. */
  allowRepeat: boolean;
};

export const DEFAULT_EXPOSURE: ExposureSettings = {
  maxActiveTotal: 10,
  maxActivePerCoin: 1,
  allowRepeat: false,
};

const EXPOSURE_KEY = "supremo-exposure-v1";

export function readExposure(): ExposureSettings {
  if (typeof localStorage === "undefined") return DEFAULT_EXPOSURE;
  try {
    const v = JSON.parse(localStorage.getItem(EXPOSURE_KEY) ?? "null");
    if (v) return sanitizeExposure(v);
  } catch {
    /* ignore */
  }
  return DEFAULT_EXPOSURE;
}

export function sanitizeExposure(v: Partial<ExposureSettings>): ExposureSettings {
  const int = (n: unknown, d: number) => (Number.isFinite(Number(n)) && Number(n) >= 1 ? Math.floor(Number(n)) : d);
  return {
    maxActiveTotal: int(v.maxActiveTotal, DEFAULT_EXPOSURE.maxActiveTotal),
    maxActivePerCoin: int(v.maxActivePerCoin, DEFAULT_EXPOSURE.maxActivePerCoin),
    allowRepeat: v.allowRepeat === true,
  };
}

export function writeExposure(s: ExposureSettings) {
  localStorage.setItem(EXPOSURE_KEY, JSON.stringify(sanitizeExposure(s)));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("supremo-exposure"));
}

/** Anti-rajada: no máximo 2 apostas ativas (pendentes + valendo) no total. */
export const MAX_ACTIVE_ANTI_RAJADA = 2;
// Sem intervalo mínimo entre apostas: com o automático ligado, cada ciclo aposta
// assim que existe uma moeda liberada. Só contam os limites de exposição.

/** Agrupa o texto de exposição num motivo estável para o painel "Por que não apostou". */
export function exposureMotivo(exposure: string): string {
  if (exposure.includes("pendentes + valendo")) return "limite de 2 ativas (pendentes + valendo)";
  return "exposição";
}

/** Máximo de apostas valendo ao mesmo tempo (todas as moedas). */
export const MAX_OPEN_TOTAL = 3;

export const isActive = (b: Pick<Bet, "status">) => b.status === "pending" || b.status === "open";

/**
 * Motivo pelo qual NÃO se pode registrar nova aposta nesta moeda/combinação,
 * ou null se pode. Apostas antigas nunca são tocadas.
 */
export function exposureBlock(
  bets: readonly (Pick<Bet, "status" | "symbol" | "combo"> & { createdAt?: number })[],
  symbol: string,
  combo: string | undefined,
  s: ExposureSettings = DEFAULT_EXPOSURE,
  now?: number,
): string | null {
  const active = bets.filter(isActive);
  const limit = Math.min(s.maxActiveTotal, MAX_ACTIVE_ANTI_RAJADA);
  if (active.length >= limit) return `limite de ${limit} apostas ativas atingido (pendentes + valendo)`;
  void now; // mantido na assinatura: os chamadores passam o instante atual
  const open = active.filter((b) => b.status === "open").length;
  if (open >= MAX_OPEN_TOTAL) return `já há ${open} apostas valendo (limite ${MAX_OPEN_TOTAL})`;
  const group = correlationGroupOf(symbol);
  if (group) {
    const peer = active.find((b) => b.symbol !== symbol && correlationGroupOf(b.symbol) === group);
    if (peer) return `grupo correlacionado ${group} já tem aposta ativa (${peer.symbol})`;
  }
  const sameCoin = active.filter((b) => b.symbol === symbol);
  if (!s.allowRepeat && sameCoin.some((b) => (b.combo ?? "") === (combo ?? "")))
    return `${symbol} já tem aposta ativa com a mesma combinação`;
  if (sameCoin.length >= s.maxActivePerCoin)
    return `${symbol} já tem ${sameCoin.length} aposta(s) ativa(s) (limite ${s.maxActivePerCoin} por moeda)`;
  return null;
}

/** Exposição total (valor × alavancagem) e concentração por moeda das apostas ativas. */
export function exposureSummary(bets: readonly Bet[]) {
  const per = new Map<string, { count: number; notional: number }>();
  let total = 0;
  for (const b of bets) {
    if (!isActive(b)) continue;
    const n = b.stake * b.leverage;
    total += n;
    const p = per.get(b.symbol) ?? { count: 0, notional: 0 };
    p.count += 1;
    p.notional += n;
    per.set(b.symbol, p);
  }
  const coins = [...per.entries()]
    .map(([symbol, v]) => ({ symbol, ...v, share: total > 0 ? v.notional / total : 0 }))
    .sort((a, b) => b.notional - a.notional);
  return { total, activeCount: coins.reduce((s, c) => s + c.count, 0), coins };
}

// ===== Estatísticas =====
export type BookStats = {
  wins: number;
  losses: number;
  open: number;
  pending: number;
  resolved: number;
  /** Apostas encerradas sem alvo nem stop (ex.: expiradas). */
  noOutcome: number;
  /** vitórias ÷ (vitórias + derrotas); null sem apostas resolvidas. */
  hitRate: number | null;
};

export function bookStats(bets: readonly Pick<Bet, "status">[]): BookStats {
  let wins = 0, losses = 0, open = 0, pending = 0, noOutcome = 0;
  for (const b of bets) {
    if (b.status === "win") wins++;
    else if (b.status === "loss") losses++;
    else if (b.status === "open") open++;
    else if (b.status === "pending") pending++;
    else noOutcome++;
  }
  const resolved = wins + losses;
  return { wins, losses, open, pending, resolved, noOutcome, hitRate: resolved ? wins / resolved : null };
}

export function hitRateText(s: Pick<BookStats, "wins" | "resolved" | "hitRate">): string {
  if (s.hitRate == null) return "Taxa de acerto: — (nenhuma aposta resolvida)";
  const pct = (s.hitRate * 100).toFixed(2).replace(".", ",");
  return `Taxa de acerto: ${pct}% — ${s.wins} vitória${s.wins === 1 ? "" : "s"} em ${s.resolved} aposta${s.resolved === 1 ? "" : "s"} resolvida${s.resolved === 1 ? "" : "s"}`;
}

// ===== Resultado financeiro =====
export type Financials = {
  /** Apenas vitórias e derrotas. */
  realized: number;
  /** Apostas valendo, marcadas ao preço atual da própria moeda. */
  unrealized: number;
  /** Margem das apostas aguardando gatilho (ainda não executadas). */
  awaiting: number;
  /** realizado + não realizado (provisório). */
  combined: number;
  /** Apostas valendo sem preço atual (não entram no não realizado). */
  unpriced: number;
};

export function financials(bets: readonly Bet[], priceFor: (symbol: string) => number | null): Financials {
  let realized = 0, unrealized = 0, awaiting = 0, unpriced = 0;
  for (const b of bets) {
    if (b.status === "win" || b.status === "loss") realized += betPnl(b, null);
    else if (b.status === "open") {
      const px = priceFor(b.symbol);
      if (px == null) unpriced++;
      else unrealized += betPnl(b, px);
    } else if (b.status === "pending") awaiting += b.stake;
  }
  return { realized, unrealized, awaiting, combined: realized + unrealized, unpriced };
}

// ===== Frescor do preço =====
export function priceAgeMs(updatedAt: number | null | undefined, now: number): number | null {
  return updatedAt == null ? null : Math.max(0, now - updatedAt);
}
export function isStale(updatedAt: number | null | undefined, now: number, maxAge = SUPREMO_MAX_AGE_MS): boolean {
  const age = priceAgeMs(updatedAt, now);
  return age == null || age > maxAge;
}

// ===== Auditoria da seleção =====
export type AuditCoin = {
  symbol: string;
  index: number;
  magnetSeconds: number;
  coverage: number;
  price: number | null;
  blocks: LiveBlock[];
  /** Bloqueio de exposição (aposta ativa, limites). */
  exposure: string | null;
  /** Pontuação histórica (0–100) e dados da chance de alvo, quando calculados. */
  score?: number | undefined;
  stars?: number | undefined;
  hitRate?: number | null | undefined;
  cycles?: number | undefined;
};

export type AuditCycle = {
  id: string;
  at: number;
  /** Regime de mercado no ciclo (informativo). */
  regime?: string | undefined;
  chosen: string | null;
  note: string | null;
  coins: AuditCoin[];
};

export type SelectionRow = {
  symbol: string;
  analysis: Pick<HourAnalysis, "index" | "top" | "coverage">;
  price: number | null;
  blocks: LiveBlock[];
  /** Quando presente, a escolha ordena por pontuação (desc). */
  score?: number | undefined;
  stars?: number | undefined;
  hitRate?: number | null | undefined;
  cycles?: number | undefined;
};

/**
 * Ordena por pontuação (quando houver) → índice → segundos no ímã e escolhe a primeira moeda sem bloqueio
 * de mercado nem de exposição. Devolve a auditoria completa do ciclo.
 */
export function selectCoin(
  rows: readonly SelectionRow[],
  exposureFor: (symbol: string) => string | null,
): { chosen: SelectionRow | null; coins: AuditCoin[] } {
  const sorted = [...rows].sort(
    (a, b) =>
      (b.score ?? -1) - (a.score ?? -1) ||
      b.analysis.index - a.analysis.index || (b.analysis.top?.seconds ?? 0) - (a.analysis.top?.seconds ?? 0),
  );
  let chosen: SelectionRow | null = null;
  const coins = sorted.map((r): AuditCoin => {
    const exposure = r.blocks.length === 0 && r.price != null ? exposureFor(r.symbol) : null;
    if (!chosen && r.blocks.length === 0 && r.price != null && !exposure) chosen = r;
    return {
      symbol: r.symbol,
      index: r.analysis.index,
      magnetSeconds: r.analysis.top?.seconds ?? 0,
      coverage: r.analysis.coverage,
      price: r.price,
      blocks: r.blocks,
      exposure,
      ...(r.score != null ? { score: r.score, stars: r.stars, hitRate: r.hitRate ?? null, cycles: r.cycles } : {}),
    };
  });
  return { chosen, coins };
}

const AUDIT_KEY = "supremo-audit-v1";
export const AUDIT_MAX = 60;

export function readAudit(): AuditCycle[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(AUDIT_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function appendAudit(c: AuditCycle): AuditCycle[] {
  const next = [c, ...readAudit()].slice(0, AUDIT_MAX);
  try {
    localStorage.setItem(AUDIT_KEY, JSON.stringify(next));
  } catch {
    /* storage cheio */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event("supremo-audit"));
  return next;
}

export function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c?.randomUUID ? c.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ===== Filtros de entrada (só acrescentam bloqueios) =====
export const STABLE_BASES = ["USDC", "FDUSD", "TUSD", "USDP", "DAI", "USDE", "EUR"] as const;
export const MIN_RANGE_24H = 0.003;
/** Faixa de entrada: preço entre 0,05% e 0,20% acima do gatilho. */
export const MIN_ABOVE_TRIGGER = 0.0005;
export const MAX_ABOVE_TRIGGER = 0.002;
/** Alta máxima nos últimos 5 min para não perseguir o preço (0,30%). */
export const MAX_RISE_5M = 0.003;

export function isStablecoin(symbol: string, range24h?: number | null): boolean {
  const base = symbol.replace(/(USDT|BRL|BUSD)$/, "");
  if ((STABLE_BASES as readonly string[]).includes(base)) return true;
  return range24h != null && range24h < MIN_RANGE_24H;
}

/**
 * Bloqueios novos: stablecoin, longe-do-gatilho, alvo-ultrapassado e
 * taxa-baixa. `abaixoEquilibrio` vem do relatório de taxa de acerto.
 */
export function entryBlocks(input: {
  symbol: string;
  price: number | null;
  plan: { trigger: number; target: number } | null;
  range24h?: number | null;
  abaixoEquilibrio?: boolean;
  /** Variação dos últimos 5 min (fração). */
  rise5m?: number | null;
}): LiveBlock[] {
  const out: LiveBlock[] = [];
  if (isStablecoin(input.symbol, input.range24h)) out.push("stablecoin");
  const { price, plan } = input;
  if (price != null && plan) {
    if (price >= plan.target) out.push("alvo-ultrapassado");
    else if (price < plan.trigger * (1 + MIN_ABOVE_TRIGGER) || price > plan.trigger * (1 + MAX_ABOVE_TRIGGER)) out.push("longe-do-gatilho");
  }
  if (input.rise5m != null && input.rise5m > MAX_RISE_5M) out.push("perseguindo-alta");
  if (input.abaixoEquilibrio) out.push("taxa-baixa");
  return out;
}

// ===== Medição por estrelinhas (Tarefa 5) =====
export type StarBucket = { stars: 1 | 2 | 3 | 4 | 5; wins: number; losses: number; rate: number | null };
export type StarReport = {
  buckets: StarBucket[];
  /** Apostas Supremo sem pontuação gravada (anteriores à medição). */
  semNota: number;
  canceladas: number;
  /** Tempo médio (min) entre o gatilho e o desfecho (vitórias + derrotas). */
  tempoMedioResolver: number | null;
};

export function starReport(
  bets: readonly Pick<Bet, "status" | "supremoMeta" | "armedAt" | "resolvedAt">[],
): StarReport {
  const buckets: StarBucket[] = ([1, 2, 3, 4, 5] as const).map((stars) => ({ stars, wins: 0, losses: 0, rate: null }));
  let semNota = 0;
  let canceladas = 0;
  const times: number[] = [];
  for (const b of bets) {
    if (b.status === "cancelled") canceladas++;
    if (b.status !== "win" && b.status !== "loss") continue;
    if (b.armedAt != null && b.resolvedAt != null && b.resolvedAt >= b.armedAt) times.push((b.resolvedAt - b.armedAt) / 60_000);
    const s = b.supremoMeta?.stars;
    if (s == null || s < 1 || s > 5) {
      semNota++;
      continue;
    }
    const k = buckets[Math.round(s) - 1]!;
    if (b.status === "win") k.wins++;
    else k.losses++;
  }
  for (const k of buckets) k.rate = k.wins + k.losses ? k.wins / (k.wins + k.losses) : null;
  return {
    buckets,
    semNota,
    canceladas,
    tempoMedioResolver: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
  };
}
