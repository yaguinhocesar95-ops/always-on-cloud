/**
 * Fonte de velas 1m do servidor: OKX principal, Bybit reserva.
 * A Binance fica só no navegador (bloqueia IPs da nuvem).
 */
import { fetchWithTimeout } from "@/lib/binance";

export type Candle1m = {
  symbol: string; // formato Binance, ex. BTCUSDT
  openTime: number;
  o: number;
  h: number;
  l: number;
  c: number;
  volume: number;
  source: "okx" | "bybit";
};

const okxId = (s: string) => `${s.slice(0, -4)}-USDT`;

export async function okxCandles(symbol: string, limit = 300): Promise<Candle1m[]> {
  const url = `https://www.okx.com/api/v5/market/candles?instId=${okxId(symbol)}&bar=1m&limit=${Math.min(limit, 300)}`;
  const r = await fetchWithTimeout(url, 8_000);
  if (!r.ok) throw new Error(`OKX ${r.status}`);
  const j = (await r.json()) as { code: string; msg: string; data: string[][] };
  if (j.code !== "0") throw new Error(`OKX ${j.code} ${j.msg}`);
  return j.data
    .map((d) => ({ symbol, openTime: Number(d[0]), o: +d[1]!, h: +d[2]!, l: +d[3]!, c: +d[4]!, volume: +d[5]!, source: "okx" as const }))
    .sort((a, b) => a.openTime - b.openTime);
}

export async function bybitCandles(symbol: string, limit = 300): Promise<Candle1m[]> {
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=1&limit=${Math.min(limit, 1000)}`;
  const r = await fetchWithTimeout(url, 8_000);
  if (!r.ok) throw new Error(`Bybit ${r.status}`);
  const j = (await r.json()) as { retCode: number; retMsg: string; result: { list: string[][] } };
  if (j.retCode !== 0) throw new Error(`Bybit ${j.retCode} ${j.retMsg}`);
  return j.result.list
    .map((d) => ({ symbol, openTime: Number(d[0]), o: +d[1]!, h: +d[2]!, l: +d[3]!, c: +d[4]!, volume: +d[5]!, source: "bybit" as const }))
    .sort((a, b) => a.openTime - b.openTime);
}

/** OKX primeiro; se falhar, Bybit. Devolve também o erro da principal, se houve. */
export async function serverCandles(symbol: string, limit = 300): Promise<{ candles: Candle1m[]; fallbackReason?: string }> {
  try {
    return { candles: await okxCandles(symbol, limit) };
  } catch (e) {
    const reason = (e as Error).message;
    return { candles: await bybitCandles(symbol, limit), fallbackReason: reason };
  }
}
