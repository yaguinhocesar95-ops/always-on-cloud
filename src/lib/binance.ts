/**
 * Endereços da Binance que o servidor da nuvem tenta, em ordem. A Binance passou a
 * recusar (403) os endereços comuns vindos da nuvem; o api-gcp responde.
 */
export const SERVER_HOSTS = [
  "https://api-gcp.binance.com",
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api1.binance.com",
];
// `let` exportado: quem importa enxerga a troca feita por pickServerHost().
export let REST_BASE = typeof window === "undefined" ? SERVER_HOSTS[0]! : "https://api.binance.com";

/** No servidor, escolhe o primeiro endereço da Binance que responde de verdade. */
export async function pickServerHost(): Promise<string> {
  const errors: string[] = [];
  for (const h of SERVER_HOSTS) {
    try {
      const r = await fetchWithTimeout(`${h}/api/v3/ticker/price?symbol=BTCUSDT`, 6_000);
      if (r.ok) {
        REST_BASE = h;
        return h;
      }
      errors.push(`${h} ${r.status}`);
    } catch (e) {
      errors.push(`${h} ${(e as Error).message}`);
    }
  }
  throw new Error(`nenhum endereço da Binance respondeu: ${errors.join("; ")}`);
}

export type SymbolInfo = {
  symbol: string;
  base: string;
  quote: string;
  price: number;
  changePct: number;
  quoteVolume: number;
};

/** Quantidade máxima de pares exibidos no seletor. */
export const MAX_PAIRS = 10;

/** Pares usados só como fallback enquanto a lista real não chega. */
export const PAIRS = [
  { symbol: "MOVRUSDT", base: "MOVR", quote: "USDT" },
  { symbol: "KAITOUSDT", base: "KAITO", quote: "USDT" },
  { symbol: "WIFUSDT", base: "WIF", quote: "USDT" },
] as const;

type Ticker24h = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
};

/**
 * As 10 moedas negociadas em dólar (USDT) com maior volume nas últimas 24h
 * na Binance (com preço e volume válidos). Ordenadas do maior para o menor volume.
 */
/** fetch com tempo-limite, para nenhuma chamada pendurada travar o automático. */
export function fetchWithTimeout(url: string, ms = 15_000): Promise<Response> {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(to));
}

export async function fetchPairs(): Promise<SymbolInfo[]> {
  const res = await fetchWithTimeout(`${REST_BASE}/api/v3/ticker/24hr`);
  if (!res.ok) throw new Error(`ticker/24hr falhou (${res.status})`);
  const rows = (await res.json()) as Ticker24h[];

  return rows
    .filter(
      (r) =>
        r.symbol.endsWith("USDT") &&
        Number(r.lastPrice) > 0 &&
        Number(r.quoteVolume) > 0,
    )
    .map((r) => ({
      symbol: r.symbol,
      base: r.symbol.slice(0, -4),
      quote: "USDT",
      price: Number(r.lastPrice),
      changePct: Number(r.priceChangePercent),
      quoteVolume: Number(r.quoteVolume),
    }))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, MAX_PAIRS);
}

export function formatPrice(value: number, quote: string): string {
  if (!isFinite(value)) return "—";
  const digits = value >= 1000 ? 2 : value >= 1 ? 4 : 6;
  const n = value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const prefix = quote === "BRL" ? "R$ " : quote === "USDT" ? "US$ " : "";
  return `${prefix}${n}`;
}

export function formatPct(value: number): string {
  if (!isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2).replace(".", ",")}%`;
}

/** Cotação USDT→BRL usada para exibir os valores em reais ou em dólar. */
export async function fetchUsdtBrl(): Promise<number> {
  const res = await fetch(`${REST_BASE}/api/v3/ticker/price?symbol=USDTBRL`);
  if (!res.ok) throw new Error(`ticker/price USDTBRL falhou (${res.status})`);
  const data = (await res.json()) as { price?: string };
  const price = Number(data.price);
  if (!isFinite(price) || price <= 0) throw new Error("cotação USDTBRL inválida");
  return price;
}
