/**
 * Fonte de velas 1m do servidor: OKX principal, Binance (endereços da nuvem) reserva, Bybit por último.
 * A Binance fica só no navegador (bloqueia IPs da nuvem).
 * Cada vela vem marcada: closed=true (fechada) ou false (minuto em andamento, provisória).
 */
import { SERVER_HOSTS, fetchWithTimeout } from "@/lib/binance";

export type Candle1m = {
  symbol: string; // formato Binance, ex. BTCUSDT
  openTime: number;
  o: number;
  h: number;
  l: number;
  c: number;
  volume: number;
  source: "okx" | "bybit" | "binance";
  /** true = vela fechada (OKX confirm=1); false = minuto em andamento, provisória. */
  closed: boolean;
};

/** Erro de fonte com o código HTTP da resposta (0 = sem resposta / tempo esgotado). */
export class SourceError extends Error {
  constructor(public source: "okx" | "bybit" | "binance", public httpStatus: number, msg: string) {
    super(msg);
  }
}

const okxId = (s: string) => `${s.slice(0, -4)}-USDT`;

async function get(source: "okx" | "bybit" | "binance", url: string): Promise<unknown> {
  let r: Response;
  try {
    r = await fetchWithTimeout(url, 8_000);
  } catch (e) {
    throw new SourceError(source, 0, `${source} sem resposta: ${(e as Error).message}`);
  }
  if (!r.ok) throw new SourceError(source, r.status, `${source} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/** Endereços da OKX: o principal e o da AWS (outra rota, outro limite de pedidos). */
export const OKX_HOSTS = ["https://www.okx.com", "https://aws.okx.com"];

export async function okxCandles(symbol: string, limit = 300, host = OKX_HOSTS[0]!): Promise<Candle1m[]> {
  const url = `${host}/api/v5/market/candles?instId=${okxId(symbol)}&bar=1m&limit=${Math.min(limit, 300)}`;
  const j = (await get("okx", url)) as { code: string; msg: string; data: string[][] };
  if (j.code !== "0") throw new SourceError("okx", 200, `okx code ${j.code} ${j.msg}`);
  return j.data
    .map((d) => ({ symbol, openTime: Number(d[0]), o: +d[1]!, h: +d[2]!, l: +d[3]!, c: +d[4]!, volume: +d[5]!, source: "okx" as const, closed: d[8] === "1" }))
    .sort((a, b) => a.openTime - b.openTime);
}

export async function bybitCandles(symbol: string, limit = 300, now = Date.now()): Promise<Candle1m[]> {
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=1&limit=${Math.min(limit, 1000)}`;
  const j = (await get("bybit", url)) as { retCode: number; retMsg: string; result: { list: string[][] } };
  if (j.retCode !== 0) throw new SourceError("bybit", 200, `bybit retCode ${j.retCode} ${j.retMsg}`);
  // A Bybit não tem campo confirm: a vela só está fechada quando o minuto dela já terminou.
  return j.result.list
    .map((d) => ({ symbol, openTime: Number(d[0]), o: +d[1]!, h: +d[2]!, l: +d[3]!, c: +d[4]!, volume: +d[5]!, source: "bybit" as const, closed: Number(d[0]) + 60_000 <= now }))
    .sort((a, b) => a.openTime - b.openTime);
}

/** Binance pelos endereços que respondem da nuvem (SERVER_HOSTS), um após o outro. */
export async function binanceCandles(symbol: string, limit = 300, now = Date.now()): Promise<Candle1m[]> {
  let last: SourceError | null = null;
  for (const h of SERVER_HOSTS) {
    try {
      const j = (await get("binance", `${h}/api/v3/klines?symbol=${symbol}&interval=1m&limit=${Math.min(limit, 1000)}`)) as (string | number)[][];
      // A Binance não tem campo confirm: fechada quando o horário de fechamento já passou.
      return j.map((d) => ({ symbol, openTime: Number(d[0]), o: +d[1]!, h: +d[2]!, l: +d[3]!, c: +d[4]!, volume: +d[5]!, source: "binance" as const, closed: Number(d[6]) < now }));
    } catch (e) {
      last = e as SourceError;
    }
  }
  throw last ?? new SourceError("binance", 0, "binance sem endereço");
}

/** OKX primeiro; se falhar, Bybit. Devolve também o erro da principal, se houve. */
export async function serverCandles(symbol: string, limit = 300): Promise<{ candles: Candle1m[]; fallbackReason?: string; okxStatus?: number }> {
  try {
    return { candles: await okxCandles(symbol, limit) };
  } catch (e) {
    const err = e as SourceError;
    try {
      return { candles: await binanceCandles(symbol, limit), fallbackReason: err.message, okxStatus: err.httpStatus };
    } catch {
      return { candles: await bybitCandles(symbol, limit), fallbackReason: err.message, okxStatus: err.httpStatus };
    }
  }
}

/** Só velas fechadas — use isto para resolver apostas e gravar estatísticas. */
export const closedOnly = (c: Candle1m[]) => c.filter((x) => x.closed);
