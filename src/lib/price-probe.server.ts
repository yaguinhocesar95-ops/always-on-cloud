/**
 * Conferência de preços feita em TODA rodada automática (mesmo sem usuários):
 * busca velas 1m das moedas do universo do servidor pela OKX (reserva Bybit).
 */
import { SourceError, bybitCandles, okxCandles, type Candle1m } from "@/lib/server-prices";

/** Universo fixo do servidor: 10 moedas listadas em USDT na OKX e na Bybit. */
export const SERVER_UNIVERSE = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT",
  "DOGEUSDT", "ADAUSDT", "TRXUSDT", "LINKUSDT", "AVAXUSDT",
] as const;

const SHOW = new Set(["BTCUSDT", "SOLUSDT"]);

const fmt = (ms: number, tz: string) =>
  new Date(ms).toLocaleString("sv-SE", { timeZone: tz, hour12: false }).replace(" ", "T");

export type CoinProbe = {
  symbol: string;
  ok: boolean;
  source?: "okx" | "bybit";
  okxStatus?: number;
  bybitStatus?: number;
  error?: string;
  hasProvisional?: boolean;
  last5?: { open_time_utc: string; open_time_brt: string; o: number; h: number; l: number; c: number; closed: boolean }[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function probeOne(symbol: string): Promise<CoinProbe> {
  let candles: Candle1m[] | null = null;
  const out: CoinProbe = { symbol, ok: false };
  try {
    try {
      candles = await okxCandles(symbol, 5);
    } catch (e) {
      // 429 = limite momentâneo da OKX: espera 1 s e tenta mais uma vez.
      if ((e as SourceError).httpStatus !== 429) throw e;
      await sleep(1_000);
      candles = await okxCandles(symbol, 5);
    }
    out.source = "okx";
    out.okxStatus = 200;
  } catch (e) {
    const err = e as SourceError;
    out.okxStatus = err.httpStatus;
    out.error = err.message;
    try {
      candles = await bybitCandles(symbol, 5);
      out.source = "bybit";
      out.bybitStatus = 200;
    } catch (e2) {
      const err2 = e2 as SourceError;
      out.bybitStatus = err2.httpStatus;
      out.error = `${err.message} | ${err2.message}`;
    }
  }
  if (candles && candles.length) {
    out.ok = true;
    out.hasProvisional = candles.some((c) => !c.closed);
    if (SHOW.has(symbol)) {
      out.last5 = candles.slice(-5).map((c) => ({
        open_time_utc: fmt(c.openTime, "UTC") + "Z",
        open_time_brt: fmt(c.openTime, "America/Sao_Paulo") + "-03:00",
        o: c.o, h: c.h, l: c.l, c: c.c, closed: c.closed,
      }));
    }
  }
  return out;
}

export async function runPriceProbe() {
  // Uma moeda por vez, com pausa: 10 pedidos simultâneos geram HTTP 429 na OKX a partir da nuvem.
  const coins: CoinProbe[] = [];
  for (const s of SERVER_UNIVERSE) {
    coins.push(await probeOne(s));
    await sleep(250);
  }
  const ok = coins.filter((c) => c.ok).length;
  const sources = [...new Set(coins.filter((c) => c.source).map((c) => c.source))];
  return { at: new Date().toISOString(), responded: ok, total: coins.length, sources, coins };
}
