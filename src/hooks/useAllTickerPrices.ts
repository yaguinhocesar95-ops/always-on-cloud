import { useEffect, useRef, useState } from "react";

const WS_URL = "wss://stream.binance.com:9443/ws/!miniTicker@arr";

type MiniTicker = { s: string; c: string };

/**
 * Preços de todos os pares da Binance em tempo real (websocket),
 * com no máximo uma atualização de estado por segundo para não
 * re-renderizar a tela a cada tick.
 */
/** Mapa de preços com o horário (ms) do último negócio recebido de cada par. */
export type PriceMap = Map<string, number> & { times?: Map<string, number> };

export function useAllTickerPrices(): PriceMap {
  const [prices, setPrices] = useState<PriceMap>(new Map());
  const latest = useRef<Map<string, number>>(new Map());
  const times = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let ws: WebSocket | null = null;
    let flush: ReturnType<typeof setInterval> | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(WS_URL);
      ws.onmessage = (ev) => {
        try {
          const rows = JSON.parse(ev.data as string) as MiniTicker[];
          for (const r of rows) {
            const p = Number(r.c);
            if (isFinite(p) && p > 0) {
              latest.current.set(r.s, p);
              times.current.set(r.s, Date.now());
            }
          }
        } catch {
          /* mensagem malformada — ignora */
        }
      };
      ws.onclose = () => {
        if (!closed) reconnect = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    flush = setInterval(() => {
      if (latest.current.size > 0) {
        const m: PriceMap = new Map(latest.current);
        m.times = new Map(times.current);
        setPrices(m);
      }
    }, 1000);

    return () => {
      closed = true;
      if (flush) clearInterval(flush);
      if (reconnect) clearTimeout(reconnect);
      ws?.close();
    };
  }, []);

  return prices;
}
