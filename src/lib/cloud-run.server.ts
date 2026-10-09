/**
 * Rodada automática no servidor: para cada usuário com o automático ligado,
 * avança as apostas com o preço atual e gera a aposta Supremo do minuto.
 */
import type { Bet } from "@/hooks/useBets";
import type { Bankroll } from "@/hooks/useBankroll";
import { advanceBet, buildBet, mergeBets } from "@/lib/bet-engine";
import { ALL_SYNC_KEYS, AUDIT_KEY, AUTO_ON_KEY, BANKROLL_KEY, BET_KEYS, CLOUD_BEAT_KEY, DAILY_RESET_KEYS, RESET_DAY_KEY, SUPREMO_BETS_KEY, TOMBSTONE_KEY, saoPauloDay } from "@/lib/cloud-keys";
import { REST_BASE, fetchWithTimeout, pickServerHost } from "@/lib/binance";
import { runSupremoCycle } from "@/lib/supremo-cycle";
import { exposureBlock, readExposure } from "@/lib/supremo-live";

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

/** localStorage em memória, preenchido com os dados do usuário durante a rodada. */
function installStorage(data: Map<string, string>) {
  const g = globalThis as { localStorage?: Storage };
  const prev = g.localStorage;
  g.localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() { return data.size; },
  } as Storage;
  return () => {
    if (prev) g.localStorage = prev;
    else delete g.localStorage;
  };
}

async function fetchAllPrices(): Promise<Map<string, number>> {
  const res = await fetchWithTimeout(`${REST_BASE}/api/v3/ticker/price`);
  if (!res.ok) throw new Error(`ticker/price falhou (${res.status})`);
  const rows = (await res.json()) as { symbol: string; price: string }[];
  return new Map(rows.map((r) => [r.symbol, Number(r.price)]));
}

const parse = <T,>(s: string | undefined, d: T): T => {
  try { return s == null ? d : (JSON.parse(s) as T); } catch { return d; }
};

// Trava com validade: se uma rodada travar, a seguinte assume depois de 2 min.
let runningSince = 0;

export async function runCloudCycle(admin: Admin) {
  if (runningSince && Date.now() - runningSince < 120_000) return { skipped: true };
  runningSince = Date.now();
  try {
    // O automático vem LIGADO por padrão (igual ao navegador): só fica de fora quem desligou.
    const { data: rows, error } = await admin.from("user_kv").select("user_id, key, value").in("key", [AUTO_ON_KEY, BANKROLL_KEY]);
    if (error) throw error;
    const off = new Set((rows ?? []).filter((r) => r.key === AUTO_ON_KEY && (r.value === false || r.value === "false")).map((r) => r.user_id));
    const users = [...new Set((rows ?? []).filter((r) => r.key === BANKROLL_KEY).map((r) => r.user_id))].filter((u) => !off.has(u));
    if (users.length === 0) return { users: 0 };
    const host = await pickServerHost();
    const prices = await fetchAllPrices();
    const usdtBrl = prices.get("USDTBRL") ?? null;
    const report: Record<string, string> = {};
    for (const uid of users) {
      try {
        report[uid] = await runForUser(admin, uid, prices, usdtBrl);
      } catch (e) {
        report[uid] = `erro: ${(e as Error).message}`;
      }
    }
    return { users: users.length, host, report };
  } finally {
    runningSince = 0;
  }
}

async function runForUser(admin: Admin, uid: string, prices: Map<string, number>, usdtBrl: number | null): Promise<string> {
  const { data: rows, error } = await admin.from("user_kv").select("key, value").eq("user_id", uid).in("key", ALL_SYNC_KEYS);
  if (error) throw error;
  const data = new Map<string, string>();
  for (const r of rows ?? []) data.set(r.key, JSON.stringify(r.value));
  const before = new Map(data);
  // Reset diário à meia-noite (Brasília): zera apostas e auditoria, sem mesclar com o antigo.
  const today = saoPauloDay();
  const didReset = data.get(RESET_DAY_KEY) !== JSON.stringify(today);
  if (didReset) {
    for (const k of DAILY_RESET_KEYS) data.set(k, "[]");
    data.set(RESET_DAY_KEY, JSON.stringify(today));
  }
  const dead = new Set(parse<string[]>(data.get(TOMBSTONE_KEY), []));
  const now = Date.now();

  // 1) Avança todas as listas de apostas com o preço atual.
  for (const key of BET_KEYS) {
    const list = parse<Bet[]>(data.get(key), []);
    if (list.length === 0) continue;
    let changed = false;
    const next = list.map((b) => {
      const r = advanceBet(b, prices.get(b.symbol) ?? null, now, key === SUPREMO_BETS_KEY);
      if (r.bet !== b) changed = true;
      return r.bet;
    });
    if (changed) data.set(key, JSON.stringify(next));
  }

  // 2) Gera a aposta Supremo do minuto.
  let result = "sem aposta";
  const bankroll = parse<Bankroll | null>(data.get(BANKROLL_KEY), null);
  if (bankroll && bankroll.stake > 0) {
    const restore = installStorage(data);
    try {
      const bets = parse<Bet[]>(data.get(SUPREMO_BETS_KEY), []);
      const r = await runSupremoCycle({ bets, bankroll, usdtBrl, livePrices: prices, place: true });
      if (r.bet) {
        const blocked = exposureBlock(bets, r.bet.symbol, r.bet.combo, readExposure(), Date.now());
        const bet = blocked ? null : buildBet(r.bet, null, "USDT", null, Date.now());
        if (bet) {
          data.set(SUPREMO_BETS_KEY, JSON.stringify([bet, ...bets]));
          result = `aposta em ${bet.symbol}`;
        } else result = `bloqueada: ${blocked}`;
      } else if (r.note) result = r.note;
    } finally {
      restore();
    }
  } else result = "sem valor por aposta";

  // Sinal de vida: o navegador só assume a geração quando este horário fica velho.
  data.set(CLOUD_BEAT_KEY, JSON.stringify(Date.now()));

  // 3) Grava só o que mudou, mesclando com o que o navegador enviou nesse meio-tempo.
  const changedKeys = [...data.keys()].filter((k) => data.get(k) !== before.get(k) && ALL_SYNC_KEYS.includes(k));
  if (changedKeys.length) {
    const { data: fresh } = await admin.from("user_kv").select("key, value").eq("user_id", uid).in("key", changedKeys);
    const freshMap = new Map((fresh ?? []).map((r) => [r.key, r.value]));
    const upserts = changedKeys.map((k) => {
      let value: unknown = JSON.parse(data.get(k)!);
      const latest = didReset ? undefined : freshMap.get(k);
      if ((BET_KEYS as readonly string[]).includes(k) && Array.isArray(latest)) value = mergeBets(value as Bet[], latest as Bet[], dead);
      else if (k === AUDIT_KEY && Array.isArray(latest)) {
        const m = new Map<string, { id: string; at: number }>();
        for (const a of [...(value as { id: string; at: number }[]), ...(latest as { id: string; at: number }[])]) m.set(a.id, a);
        value = [...m.values()].sort((a, b) => b.at - a.at).slice(0, 60);
      }
      return { user_id: uid, key: k, value: value as never, updated_at: new Date().toISOString() };
    });
    const { error: upErr } = await admin.from("user_kv").upsert(upserts);
    if (upErr) throw upErr;
  }
  return result;
}
