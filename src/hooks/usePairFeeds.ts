/**
 * Leitura ao vivo dos 180 segundos de VÁRIOS pares ao mesmo tempo.
 *
 * Mesma matéria-prima do par selecionado (`useLivePrice`): semente de velas de
 * 1 s pela REST + negócios em tempo real por websocket. Nada é calculado aqui —
 * o hook só entrega a janela crua de cada par para o motor existente.
 *
 * Robustez do fluxo (sem inventar número nenhum):
 * - vigia o websocket e, se o fluxo parar de chegar, reconecta sozinho;
 * - a cada (re)conexão recarrega o histórico de 180 s de cada par pela REST,
 *   para não ficar buraco na janela;
 * - registra o instante do último negócio de cada par, para a interface poder
 *   avisar "dados atrasados" quando um par parar de atualizar.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { MAX_POINTS, WINDOW_MS } from "@/lib/scalp";
import type { RawTick } from "@/lib/feed-quality";
import { fetchSeedWindows, fetchSpotPrices, fillGaps, mergeTicks } from "@/lib/history-seed";

const MAX_RAW_PER_SYMBOL = MAX_POINTS * 4;

/** Sem nenhum quadro do stream por este tempo = fluxo parado, força reconexão. */
export const STREAM_SILENCE_MS = 15_000;
/** Par sem leitura nova por este tempo = dado atrasado (aviso na interface). */
export const PAIR_STALE_MS = 60_000;
/** Intervalo do batimento por REST que mantém todos os pares com preço fresco. */
const HEARTBEAT_MS = 2_000;

export type StreamStatus = "conectando" | "ao-vivo" | "reconectando";

export type PairFeeds = {
  /** Janela crua de 180 s por par, atualizada uma vez por segundo. */
  windows: Map<string, RawTick[]>;
  /** Instante do último negócio recebido por par (ms). */
  lastTickAt: Map<string, number>;
  /** Pares sem atualização há mais de um minuto. */
  stale: Set<string>;
  status: StreamStatus;
  /** Quantas vezes o fluxo precisou ser reconectado nesta sessão. */
  reconnects: number;
  /** Última vez que o stream entregou qualquer quadro. */
  lastFrameAt: number | null;
  /** Pares cujo histórico de 180 s já foi carregado (janela pronta). */
  seeded: Set<string>;
  /** true quando todos os pares já têm a janela histórica completa. */
  historyReady: boolean;
};

const EMPTY: PairFeeds = {
  windows: new Map(),
  lastTickAt: new Map(),
  stale: new Set(),
  status: "conectando",
  reconnects: 0,
  lastFrameAt: null,
  seeded: new Set(),
  historyReady: false,
};

function prune(list: RawTick[], cutoff: number): RawTick[] {
  const inWindow = list.filter((t) => t.time >= cutoff);
  return inWindow.length > MAX_RAW_PER_SYMBOL
    ? inWindow.slice(inWindow.length - MAX_RAW_PER_SYMBOL)
    : inWindow;
}

export function usePairFeeds(symbols: readonly string[]): PairFeeds {
  const key = symbols.join(",");
  const [windows, setWindows] = useState<Map<string, RawTick[]>>(() => new Map());
  const [lastTickAt, setLastTickAt] = useState<Map<string, number>>(() => new Map());
  const [stale, setStale] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState<StreamStatus>("conectando");
  const [reconnects, setReconnects] = useState(0);
  const [lastFrameAt, setLastFrameAt] = useState<number | null>(null);
  const [seeded, setSeeded] = useState<Set<string>>(() => new Set());
  const seededRef = useRef<Set<string>>(new Set());

  const store = useRef<Map<string, RawTick[]>>(new Map());
  const ticks = useRef<Map<string, number>>(new Map());
  const frameAt = useRef<number | null>(null);

  const reset = useCallback(() => {
    store.current = new Map();
    ticks.current = new Map();
    frameAt.current = null;
    seededRef.current = new Set();
    setSeeded(new Set());
  }, []);

  useEffect(() => {
    const list = key.length > 0 ? key.split(",") : [];
    if (list.length === 0) {
      setWindows(EMPTY.windows);
      setLastTickAt(EMPTY.lastTickAt);
      setStale(EMPTY.stale);
      setSeeded(EMPTY.seeded);
      return;
    }

    let closed = false;
    reset();
    setStatus("conectando");
    setReconnects(0);

    // Semente: histórico real dos últimos 180 s de cada par, buscado em lotes
    // pequenos e com novas tentativas. Roda na primeira conexão e em toda
    // reconexão, para fechar o buraco do período offline. Com isso a janela de
    // cada par já nasce completa — nenhum par precisa "aquecer".
    const seedAbort = new AbortController();
    let seedInFlight = false;
    const loadHistory = (only?: string[]) => {
      const targets = only ?? list;
      if (targets.length === 0 || seedInFlight) return;
      seedInFlight = true;
      void fetchSeedWindows(
        targets,
        (symbol, history) => {
          if (closed) return;
          const merged = mergeTicks(store.current.get(symbol) ?? [], history);
          store.current.set(symbol, prune(merged, Date.now() - WINDOW_MS));
          seededRef.current.add(symbol);
          setSeeded(new Set(seededRef.current));
        },
        seedAbort.signal,
      ).finally(() => {
        seedInFlight = false;
      });
    };

    loadHistory();

    // Reposição contínua: pares cuja semente falhou (limite de requisições,
    // rede) ou cuja janela ficou com buraco são recarregados a cada 8 s, até
    // todos terem os 180 s completos. Nenhum par fica "preso" sem dado.
    const reseed = setInterval(() => {
      if (closed) return;
      const now = Date.now();
      const missing = list.filter((s) => {
        if (!seededRef.current.has(s)) return true;
        const w = store.current.get(s) ?? [];
        const first = w[0];
        const last = w[w.length - 1];
        return !first || !last || first.time > now - WINDOW_MS * 0.8 || now - last.time > 30_000;
      });
      if (missing.length > 0) loadHistory(missing);
    }, 8_000);

    let ws: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let first = true;

    const connect = () => {
      if (closed) return;
      const streams = list.map((s) => `${s.toLowerCase()}@trade`).join("/");
      ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

      ws.onopen = () => {
        if (closed) return;
        setStatus("ao-vivo");
        // Reconexão: recarrega o histórico para não deixar lacuna na janela.
        if (!first) loadHistory();
        first = false;
      };

      ws.onmessage = (ev) => {
        frameAt.current = Date.now();
        try {
          const frame = JSON.parse(ev.data as string) as {
            data?: { s?: string; p?: string; T?: number; E?: number };
          };
          const d = frame.data;
          const symbol = d?.s;
          const price = Number(d?.p);
          if (!symbol || !isFinite(price) || price <= 0) return;
          const time = typeof d?.T === "number" ? d.T : (d?.E ?? Date.now());
          const current = store.current.get(symbol) ?? [];
          current.push({ time, price, source: "trade" });
          store.current.set(symbol, prune(current, Date.now() - WINDOW_MS));
          ticks.current.set(symbol, Date.now());
        } catch {
          /* quadro malformado — ignora */
        }
      };

      ws.onerror = () => ws?.close();
      ws.onclose = () => {
        if (closed) return;
        setStatus("reconectando");
        reconnect = setTimeout(connect, 3000);
      };
    };

    const forceReconnect = () => {
      if (closed) return;
      setReconnects((n) => n + 1);
      setStatus("reconectando");
      frameAt.current = Date.now(); // evita disparar de novo no próximo ciclo
      const dying = ws;
      ws = null;
      if (dying) {
        dying.onclose = null;
        dying.onerror = null;
        dying.onmessage = null;
        dying.close();
      }
      if (reconnect) clearTimeout(reconnect);
      reconnect = setTimeout(connect, 500);
    };

    connect();

    // Batimento por REST: pares que negociam pouco não recebem quadro do
    // websocket por minutos inteiros. Aqui o preço atual de TODOS os pares vem
    // da corretora numa única requisição, a cada 2 s, mantendo toda a lista com
    // leitura fresca (fim do "dados atrasados" em massa).
    let beatInFlight = false;
    const heartbeat = setInterval(() => {
      if (closed || beatInFlight) return;
      beatInFlight = true;
      void fetchSpotPrices(list, seedAbort.signal)
        .then((prices) => {
          if (closed) return;
          const at = Date.now();
          for (const [symbol, price] of prices) {
            const current = store.current.get(symbol) ?? [];
            const last = current[current.length - 1];
            if (!last || last.price !== price || at - last.time >= 1000) {
              current.push({ time: at, price, source: "rest" });
              store.current.set(symbol, prune(current, at - WINDOW_MS));
            }
            ticks.current.set(symbol, at);
          }
        })
        .finally(() => {
          beatInFlight = false;
        });
    }, HEARTBEAT_MS);

    // Um único relógio de 1 s publica a janela, a defasagem por par e vigia o
    // silêncio do stream.
    const flush = setInterval(() => {
      const now = Date.now();
      const cutoff = now - WINDOW_MS;

      const nextWindows = new Map<string, RawTick[]>();
      const nextTicks = new Map<string, number>();
      const nextStale = new Set<string>();
      for (const symbol of list) {
        // Segundos sem negócio ficam com o último preço real da corretora, para
        // a cobertura da janela refletir o mercado parado em vez de um buraco.
        const raw = prune(store.current.get(symbol) ?? [], cutoff);
        nextWindows.set(symbol, fillGaps(raw, now, WINDOW_MS));
        const at = ticks.current.get(symbol);
        if (at != null) nextTicks.set(symbol, at);
        if (at == null || now - at > PAIR_STALE_MS) nextStale.add(symbol);
      }
      setWindows(nextWindows);
      setLastTickAt(nextTicks);
      setStale(nextStale);
      setLastFrameAt(frameAt.current);

      const silent = frameAt.current == null || now - frameAt.current > STREAM_SILENCE_MS;
      const connecting = ws?.readyState === WebSocket.CONNECTING;
      if (silent && !connecting) forceReconnect();
    }, 1000);

    // Volta do segundo plano / rede: revalida o fluxo na hora.
    const onWake = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (frameAt.current == null || now - frameAt.current > STREAM_SILENCE_MS) forceReconnect();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);

    return () => {
      closed = true;
      seedAbort.abort();
      clearInterval(flush);
      clearInterval(heartbeat);
      clearInterval(reseed);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      if (reconnect) clearTimeout(reconnect);
      ws?.close();
    };
  }, [key, reset]);

  const historyReady = symbols.length > 0 && symbols.every((s) => seeded.has(s));

  return { windows, lastTickAt, stale, status, reconnects, lastFrameAt, seeded, historyReady };
}
