/**
 * Semente histórica da janela de 180 s.
 *
 * O motor precisa da janela cheia para produzir sinal. Em vez de "aquecer" ao
 * vivo (acumulando leituras minuto a minuto), carregamos aqui as velas reais de
 * 1 segundo já fechadas na Binance, de forma robusta:
 *
 * - tentativas com espera crescente, para sobreviver a limite de requisições;
 * - poucas requisições em paralelo, para não estourar esse limite;
 * - mescla determinística com o que já existe (ordenada por tempo), porque
 *   leituras fora de ordem são descartadas pela normalização.
 *
 * Resultado: assim que a semente chega, a janela já está completa e o painel
 * pula direto para "ativo" / "sem gatilho ainda" — sem fase de aquecimento.
 */

import type { RawTick } from "@/lib/feed-quality";

/** Hosts públicos da Binance: se um falhar/limitar, tenta o próximo. */
const HOSTS = ["https://api.binance.com", "https://data-api.binance.vision", "https://api1.binance.com"];

/** Quantos segundos de histórico buscar (uma vela de 1 s por segundo). */
export const SEED_SECONDS = 180;
/** Requisições simultâneas ao carregar vários pares. */
const CONCURRENCY = 12;
/** Tentativas por par antes de desistir desta rodada. */
const ATTEMPTS = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Busca as últimas velas de 1 s de um par. Vazio = falhou nesta rodada. */
export async function fetchSeedWindow(
  symbol: string,
  signal?: AbortSignal,
): Promise<RawTick[]> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (signal?.aborted) return [];
    try {
      const host = HOSTS[attempt % HOSTS.length];
      const res = await fetch(
        `${host}/api/v3/klines?symbol=${symbol}&interval=1s&limit=${SEED_SECONDS}`,
        { signal: signal ?? null },
      );
      // Par inexistente/deslistado: não adianta insistir.
      if (res.status === 400) return [];
      if (res.ok) {
        const rows: unknown = await res.json();
        if (Array.isArray(rows)) {
          const history: RawTick[] = [];
          for (const k of rows as unknown[][]) {
            const time = Number(k[0]);
            const close = Number(k[4]);
            if (isFinite(time) && isFinite(close) && close > 0) {
              history.push({ time, price: close, source: "seed" });
            }
          }
          if (history.length > 0) return history;
        }
      }
    } catch {
      /* rede instável — tenta de novo abaixo */
    }
    await sleep(400 * 2 ** attempt);
  }
  return [];
}

/**
 * Carrega a semente de vários pares em lotes pequenos, entregando cada par
 * assim que ele chega.
 */
export async function fetchSeedWindows(
  symbols: readonly string[],
  onReady: (symbol: string, history: RawTick[]) => void,
  signal?: AbortSignal,
): Promise<void> {
  const queue = [...symbols];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      if (signal?.aborted) return;
      const symbol = queue.shift()!;
      const history = await fetchSeedWindow(symbol, signal);
      if (signal?.aborted) return;
      if (history.length > 0) onReady(symbol, history);
    }
  });
  await Promise.all(workers);
}

/** Endpoint de preço à vista (lote de vários pares em uma requisição só). */

/**
 * Preço atual de vários pares numa única requisição. Serve de batimento
 * cardíaco: pares que negociam pouco continuam com leitura fresca da própria
 * corretora, em vez de aparecerem como "dados atrasados".
 */
export async function fetchSpotPrices(
  symbols: readonly string[],
  signal?: AbortSignal,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (symbols.length === 0) return out;
  // Busca o preço de TODOS os pares numa requisição só e filtra aqui: pedir
  // uma lista com um par deslistado faz a corretora recusar o lote inteiro.
  const wanted = new Set(symbols);
  for (const host of HOSTS) {
    if (signal?.aborted) return out;
    try {
      const res = await fetch(`${host}/api/v3/ticker/price`, { signal: signal ?? null });
      if (!res.ok) continue;
      const rows: unknown = await res.json();
      if (!Array.isArray(rows)) continue;
      for (const row of rows as { symbol?: string; price?: string }[]) {
        const price = Number(row?.price);
        if (row?.symbol && wanted.has(row.symbol) && isFinite(price) && price > 0) {
          out.set(row.symbol, price);
        }
      }
      return out;
    } catch {
      /* host instável — tenta o próximo */
    }
  }
  return out;
}

/**
 * Por quanto tempo o último preço conhecido continua valendo quando não chega
 * negócio novo. Depois disso o feed é considerado realmente parado.
 */
export const MAX_HOLD_SECONDS = 20;

/**
 * Preenche os segundos sem negócio com o último preço realmente negociado
 * (segurado por no máximo `MAX_HOLD_SECONDS`). Par que negocia pouco deixa de
 * parecer "atrasado" sem que nenhum preço seja inventado: o preço mantido é o
 * último preço de verdade da corretora.
 */
export function fillGaps(
  list: readonly RawTick[],
  now: number,
  windowMs: number,
): RawTick[] {
  if (list.length === 0) return [];
  const sorted = [...list].sort((a, b) => a.time - b.time);
  const cutoff = now - windowMs;
  const out: RawTick[] = [];
  let lastSecond: number | null = null;
  let lastPrice: number | null = null;

  const pushHolds = (fromSecond: number, toSecond: number, price: number) => {
    for (let s = fromSecond + 1; s < toSecond; s++) {
      if (s * 1000 < cutoff) continue;
      out.push({ time: s * 1000, price, source: "hold" });
    }
  };

  for (const t of sorted) {
    const second = Math.floor(t.time / 1000);
    if (lastSecond != null && lastPrice != null && second - lastSecond > 1) {
      pushHolds(lastSecond, Math.min(second, lastSecond + MAX_HOLD_SECONDS + 1), lastPrice);
    }
    out.push(t);
    lastSecond = second;
    lastPrice = t.price;
  }

  // Segura o último preço até agora (limitado), para a idade da leitura não
  // disparar "dado velho" num par que simplesmente não negociou neste segundo.
  const nowSecond = Math.floor(now / 1000);
  if (lastSecond != null && lastPrice != null && nowSecond > lastSecond) {
    pushHolds(lastSecond, Math.min(nowSecond + 1, lastSecond + MAX_HOLD_SECONDS + 1), lastPrice);
  }

  out.sort((a, b) => a.time - b.time);
  return out;
}

/**
 * Mescla leituras mantendo ordem cronológica e sem duplicar o mesmo instante.
 * Ordem crescente é obrigatória: a normalização descarta leitura atrasada.
 */
export function mergeTicks(
  existing: readonly RawTick[],
  incoming: readonly RawTick[],
): RawTick[] {
  const seen = new Set(existing.map((t) => `${t.time}:${t.price}`));
  const merged = [...existing];
  for (const t of incoming) {
    const key = `${t.time}:${t.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(t);
  }
  merged.sort((a, b) => a.time - b.time);
  return merged;
}
