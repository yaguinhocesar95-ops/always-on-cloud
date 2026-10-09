/**
 * Placar de Estrelinhas — lógica pura do ranking de acompanhamento Supremo.
 * Sem rede, sem relógio: tudo recebe `now` e dados prontos. Percentuais em fração.
 */
import { betVariation, type Bet } from "@/hooks/useBets";
import { wilsonLower } from "@/lib/supremo-hitrate";
import type { AuditCycle } from "@/lib/supremo-live";
import { MAX_ABOVE_TRIGGER, exposureMotivo } from "@/lib/supremo-live";
import { round2, toUsdt, type FxQuote } from "@/lib/fx-totals";

export const SNAPSHOT_KEY = "supremo-ranking-snapshots-v1";
export const SNAPSHOT_MAX_MS = 24 * 3_600_000;
export const SMALL_BUCKET = 15;
const H = 3_600_000;

export type Snapshot = { t: number; symbol: string; score: number; stars: number; status: string };

/** Acrescenta snapshots e descarta os mais antigos que 24 h. */
export function appendSnapshots(prev: readonly Snapshot[], add: readonly Snapshot[], now: number): Snapshot[] {
  return [...prev, ...add].filter((s) => s.t >= now - SNAPSHOT_MAX_MS && s.t <= now + 60_000);
}

export type Trend = "subiu" | "desceu" | "estavel" | null;

/** Compara a pontuação atual com o ciclo anterior (último snapshot antes do ciclo mais recente). */
export function scoreTrend(snaps: readonly Snapshot[], symbol: string, current: number | null): Trend {
  if (current == null) return null;
  const mine = snaps.filter((s) => s.symbol === symbol).sort((a, b) => a.t - b.t);
  if (mine.length === 0) return null;
  const last = mine[mine.length - 1]!;
  // Se o último snapshot já é o ciclo atual (mesma pontuação registrada agora), olha o anterior.
  const prev = last.score === current && mine.length > 1 ? mine[mine.length - 2]! : last.score === current ? null : last;
  if (!prev) return null;
  if (current > prev.score) return "subiu";
  if (current < prev.score) return "desceu";
  return "estavel";
}

export function avgStars(audit: readonly AuditCycle[], symbol: string, now: number, hours = 6): number | null {
  const xs: number[] = [];
  for (const c of audit) {
    if (c.at < now - hours * H) continue;
    const coin = c.coins.find((k) => k.symbol === symbol);
    if (coin?.stars != null) xs.push(coin.stars);
  }
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

// ===== Moedas =====
export type CoinInput = {
  symbol: string;
  score: number | null;
  stars: number | null;
  price: number | null;
  trigger: number | null;
  /** Motivos de bloqueio já em texto. */
  blocks: string[];
  touches: { h1: number; h3: number; h6: number } | null;
  cycles: { wins: number; n: number } | null;
  dentro: boolean | null;
};

export type CoinStatus = "Será a próxima aposta" | "Monitorando" | "Aposta ativa" | `Bloqueada: ${string}`;
export type Behavior = "Dentro do esperado" | "Fora do padrão" | "Amostra pequena";

export type BetCounts = { pendentes: number; valendo: number; ganhas: number; perdidas: number; canceladas: number; lucro: number; excluidas: number };

export type CoinRow = CoinInput & {
  trend: Trend;
  avgStars6h: number | null;
  status: CoinStatus;
  distTrigger: number | null;
  withinLimit: boolean;
  hitRate: number | null;
  wilsonLow: number | null;
  behavior: Behavior;
  history: BetCounts;
};

export function emptyCounts(): BetCounts {
  return { pendentes: 0, valendo: 0, ganhas: 0, perdidas: 0, canceladas: 0, lucro: 0, excluidas: 0 };
}

/** Resultado líquido em USDT (null sem conversão possível). */
export function betNetUsdt(b: Bet, px: number | null, fx: FxQuote | null | undefined, now: number): number | null {
  if (b.status !== "win" && b.status !== "loss" && b.status !== "open") return null;
  if (b.status === "open" && px == null) return null;
  const val = b.stake * b.leverage * betVariation(b, px);
  const c = toUsdt(val, b.stakeCurrency ?? "USDT", fx, now);
  return c.ok ? c.usdt : null;
}

function countsFor(bets: readonly Bet[], fx: FxQuote | null | undefined, now: number): BetCounts {
  const c = emptyCounts();
  for (const b of bets) {
    if (b.status === "pending") c.pendentes++;
    else if (b.status === "open") c.valendo++;
    else if (b.status === "cancelled") c.canceladas++;
    else {
      if (b.status === "win") c.ganhas++;
      else c.perdidas++;
      const v = betNetUsdt(b, null, fx, now);
      if (v == null) c.excluidas++;
      else c.lucro += v;
    }
  }
  c.lucro = round2(c.lucro);
  return c;
}

export function rankingMoedas(input: {
  coins: readonly CoinInput[];
  bets: readonly Bet[];
  snapshots: readonly Snapshot[];
  audit: readonly AuditCycle[];
  nextPick: string | null;
  fx: FxQuote | null | undefined;
  now: number;
}): CoinRow[] {
  const { coins, bets, snapshots, audit, nextPick, fx, now } = input;
  return coins
    .map((c): CoinRow => {
      const mine = bets.filter((b) => b.symbol === c.symbol);
      const active = mine.some((b) => b.status === "pending" || b.status === "open");
      const status: CoinStatus = active
        ? "Aposta ativa"
        : c.symbol === nextPick
          ? "Será a próxima aposta"
          : c.blocks.length
            ? `Bloqueada: ${c.blocks[0]}`
            : "Monitorando";
      const distTrigger = c.price != null && c.trigger ? (c.price - c.trigger) / c.trigger : null;
      const n = c.cycles?.n ?? 0;
      const wins = c.cycles?.wins ?? 0;
      const behavior: Behavior = n < SMALL_BUCKET ? "Amostra pequena" : c.dentro ? "Dentro do esperado" : "Fora do padrão";
      return {
        ...c,
        trend: scoreTrend(snapshots, c.symbol, c.score),
        avgStars6h: avgStars(audit, c.symbol, now),
        status,
        distTrigger,
        withinLimit: distTrigger != null && distTrigger >= 0 && distTrigger <= MAX_ABOVE_TRIGGER,
        hitRate: n ? wins / n : null,
        wilsonLow: n ? wilsonLower(wins, n) : null,
        behavior,
        history: countsFor(mine, fx, now),
      };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

// ===== Apostas =====
export type Progress = { pos: number; toTarget: number; toStop: number } | null;

/** Posição do preço entre stop (0) e alvo (1). Pendentes/canceladas: null. */
export function betProgress(b: Pick<Bet, "status" | "target" | "stop">, px: number | null): Progress {
  if (!(b.target > b.stop)) return null;
  if (b.status === "win") return { pos: 1, toTarget: 0, toStop: (b.target - b.stop) / b.target };
  if (b.status === "loss") return { pos: 0, toTarget: (b.target - b.stop) / b.stop, toStop: 0 };
  if (b.status !== "open" || px == null || !(px > 0)) return null;
  const pos = Math.min(1, Math.max(0, (px - b.stop) / (b.target - b.stop)));
  return { pos, toTarget: Math.max(0, (b.target - px) / px), toStop: Math.max(0, (px - b.stop) / px) };
}

export const STATUS_LABEL: Record<Bet["status"], string> = {
  pending: "aguardando gatilho",
  open: "valendo",
  win: "ganhou",
  loss: "perdeu",
  cancelled: "cancelada",
};

export type BetRow = {
  bet: Bet;
  stars: number | null;
  score: number | null;
  status: string;
  sinceCreate: number;
  toArm: number | null;
  toResolve: number | null;
  progress: Progress;
  netPct: number | null;
  netUsdt: number | null;
};

const isActive = (b: Bet) => b.status === "pending" || b.status === "open";

export function rankingApostas(bets: readonly Bet[], priceFor: (s: string) => number | null, fx: FxQuote | null | undefined, now: number): BetRow[] {
  return [...bets]
    .sort((a, b) => Number(isActive(b)) - Number(isActive(a)) || b.createdAt - a.createdAt)
    .map((b) => {
      const px = priceFor(b.symbol);
      const resolved = b.status === "win" || b.status === "loss";
      return {
        bet: b,
        stars: b.starsAtCreate ?? null,
        score: b.scoreAtCreate ?? null,
        status: b.status === "cancelled" && b.cancelReason ? `cancelada: ${b.cancelReason}` : STATUS_LABEL[b.status],
        sinceCreate: now - b.createdAt,
        toArm: b.armedAt != null ? b.armedAt - b.createdAt : null,
        toResolve: resolved && b.resolvedAt != null ? b.resolvedAt - (b.armedAt ?? b.createdAt) : null,
        progress: betProgress(b, px),
        netPct: resolved || (b.status === "open" && px != null) ? betVariation(b, px) : null,
        netUsdt: betNetUsdt(b, px, fx, now),
      };
    });
}

// ===== Placar por estrelinhas =====
export type StarBand = {
  stars: 1 | 2 | 3 | 4 | 5;
  total: number;
  resolvidas: number;
  ganhas: number;
  perdidas: number;
  canceladas: number;
  taxa: number | null;
  wilsonLow: number | null;
  lucroTotal: number;
  lucroMedio: number | null;
  tempoMedianoMs: number | null;
  vsEquilibrio: "acima" | "abaixo" | null;
  amostraPequena: boolean;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Apostas sem `starsAtCreate` ficam fora. Lucro em USDT (só valores conversíveis). */
export function placarPorEstrelas(bets: readonly Bet[], fx: FxQuote | null | undefined, now: number, breakEven: number): { bands: StarBand[]; semEstrelas: number; breakEven: number } {
  let semEstrelas = 0;
  const bands = ([1, 2, 3, 4, 5] as const).map((stars) => {
    const mine = bets.filter((b) => b.starsAtCreate != null && Math.round(b.starsAtCreate) === stars);
    const g = mine.filter((b) => b.status === "win").length;
    const p = mine.filter((b) => b.status === "loss").length;
    const lucros = mine.map((b) => (b.status === "win" || b.status === "loss" ? betNetUsdt(b, null, fx, now) : null)).filter((v): v is number => v != null);
    const times = mine
      .filter((b) => (b.status === "win" || b.status === "loss") && b.resolvedAt != null)
      .map((b) => b.resolvedAt! - (b.armedAt ?? b.createdAt));
    const taxa = g + p ? g / (g + p) : null;
    const lucroTotal = round2(lucros.reduce((a, b) => a + b, 0));
    return {
      stars,
      total: mine.length,
      resolvidas: g + p,
      ganhas: g,
      perdidas: p,
      canceladas: mine.filter((b) => b.status === "cancelled").length,
      taxa,
      wilsonLow: g + p ? wilsonLower(g, g + p) : null,
      lucroTotal,
      lucroMedio: lucros.length ? round2(lucroTotal / lucros.length) : null,
      tempoMedianoMs: median(times),
      vsEquilibrio: taxa == null ? null : taxa >= breakEven ? ("acima" as const) : ("abaixo" as const),
      amostraPequena: g + p < SMALL_BUCKET,
    };
  });
  for (const b of bets) if (b.starsAtCreate == null) semEstrelas++;
  return { bands, semEstrelas, breakEven };
}

/** Texto de leitura automática comparando 4–5 com 1–2 estrelinhas. */
export function leituraPlacar(bands: readonly StarBand[]): { texto: string | null; invertido: boolean } {
  const rate = (xs: StarBand[]) => {
    const g = xs.reduce((s, b) => s + b.ganhas, 0), n = xs.reduce((s, b) => s + b.resolvidas, 0);
    return n ? g / n : null;
  };
  const hi = rate(bands.filter((b) => b.stars >= 4));
  const lo = rate(bands.filter((b) => b.stars <= 2));
  if (hi == null || lo == null) return { texto: null, invertido: false };
  const f = (v: number) => `${(v * 100).toFixed(0)}%`;
  return { texto: `4–5 estrelinhas acertam ${f(hi)} contra ${f(lo)} das de 1–2.`, invertido: hi < lo };
}

// ===== Resumo geral =====
export type Streak = { tipo: "vitorias" | "derrotas"; n: number } | null;

export function currentStreak(bets: readonly Pick<Bet, "status" | "resolvedAt">[]): Streak {
  const res = bets
    .filter((b) => (b.status === "win" || b.status === "loss") && b.resolvedAt != null)
    .sort((a, b) => b.resolvedAt! - a.resolvedAt!);
  if (!res.length) return null;
  const first = res[0]!.status;
  let n = 0;
  for (const b of res) {
    if (b.status !== first) break;
    n++;
  }
  return { tipo: first === "win" ? "vitorias" : "derrotas", n };
}

export function resumoGeral(bets: readonly Bet[], fx: FxQuote | null | undefined, now: number) {
  const g = bets.filter((b) => b.status === "win").length;
  const p = bets.filter((b) => b.status === "loss").length;
  const perCoin = new Map<string, number>();
  let lucro = 0;
  let excluidas = 0;
  for (const b of bets) {
    if (b.status !== "win" && b.status !== "loss") continue;
    const v = betNetUsdt(b, null, fx, now);
    if (v == null) {
      excluidas++;
      continue;
    }
    lucro += v;
    perCoin.set(b.symbol, (perCoin.get(b.symbol) ?? 0) + v);
  }
  const ranked = [...perCoin.entries()].sort((a, b) => b[1] - a[1]);
  return {
    total: bets.length,
    ativas: bets.filter(isActive).length,
    taxa: g + p ? g / (g + p) : null,
    lucro: round2(lucro),
    excluidas,
    melhor: ranked[0] ? { symbol: ranked[0][0], lucro: round2(ranked[0][1]) } : null,
    pior: ranked.length > 1 ? { symbol: ranked[ranked.length - 1]![0], lucro: round2(ranked[ranked.length - 1]![1]) } : null,
    sequencia: currentStreak(bets),
    estrelinhas: bets.filter((b) => b.status === "win").reduce((s, b) => s + (b.starsAtCreate ?? 0), 0),
  };
}

// ===== CSV =====
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(esc).join(";")).join("\n");
}

// ===== Placar de validação =====
export const META_SAMPLE = 30;

export type GroupStat = { key: string; ganhas: number; perdidas: number; taxa: number | null; lucro: number };

function groupBy(bets: readonly Bet[], keyOf: (b: Bet) => string | null, fx: FxQuote | null | undefined, now: number): GroupStat[] {
  const m = new Map<string, GroupStat>();
  for (const b of bets) {
    if (b.status !== "win" && b.status !== "loss") continue;
    const k = keyOf(b);
    if (k == null) continue;
    const g = m.get(k) ?? { key: k, ganhas: 0, perdidas: 0, taxa: null, lucro: 0 };
    if (b.status === "win") g.ganhas++;
    else g.perdidas++;
    g.lucro += betNetUsdt(b, null, fx, now) ?? 0;
    m.set(k, g);
  }
  return [...m.values()].map((g) => ({ ...g, lucro: round2(g.lucro), taxa: g.ganhas / (g.ganhas + g.perdidas) }));
}

/** Acerto/lucro por regime gravado na criação e por moeda; meta = ponto de equilíbrio da combinação com 30 resolvidas. */
export function placarValidacao(bets: readonly Bet[], fx: FxQuote | null | undefined, now: number, breakEven: number) {
  const porRegime = (["calmo", "queda", "alta", "indefinido"] as const).map(
    (r) => groupBy(bets, (b) => b.regimeAtCreate ?? null, fx, now).find((g) => g.key === r) ?? { key: r, ganhas: 0, perdidas: 0, taxa: null, lucro: 0 },
  );
  const porMoeda = groupBy(bets, (b) => b.symbol, fx, now).sort((a, b) => b.lucro - a.lucro);
  const resolvidas = bets.filter((b) => b.status === "win" || b.status === "loss").length;
  const ganhas = bets.filter((b) => b.status === "win").length;
  const taxa = resolvidas ? ganhas / resolvidas : null;
  return {
    porRegime,
    maisGanham: porMoeda.slice(0, 3),
    maisPerdem: [...porMoeda].reverse().filter((g) => g.lucro < 0).slice(0, 3),
    resolvidas,
    progresso: Math.min(1, resolvidas / META_SAMPLE),
    metaAtingida: resolvidas >= META_SAMPLE && taxa != null && taxa >= breakEven,
    breakEven,
  };
}

// ===== Por que não apostou =====
/** Conta, nos últimos 60 ciclos sem aposta, quantos tiveram cada motivo (uma vez por ciclo). */
export function whyNoBet(audit: readonly AuditCycle[], max = 60): { motivo: string; ciclos: number }[] {
  const counts = new Map<string, number>();
  for (const c of audit.slice(0, max)) {
    if (c.chosen) continue;
    const seen = new Set<string>();
    for (const coin of c.coins) {
      for (const b of coin.blocks) seen.add(b);
      if (coin.exposure) seen.add(exposureMotivo(coin.exposure));
    }
    for (const k of seen) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].map(([motivo, ciclos]) => ({ motivo, ciclos })).sort((a, b) => b.ciclos - a.ciclos);
}
