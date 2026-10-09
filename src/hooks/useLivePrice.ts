import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_POINTS, WINDOW_MS } from "@/lib/scalp";
import { normalizeTicks, type FeedQuality, type RawTick } from "@/lib/feed-quality";
import { fetchSeedWindow, fillGaps, mergeTicks } from "@/lib/history-seed";

export type LiveStatus = "connecting" | "live" | "reconnecting" | "offline";

/** Teto da espera entre reconexões. */
const MAX_BACKOFF_MS = 30_000;
/** Silêncio tolerado antes de buscar o preço por REST. */
const SILENCE_MS = 800;
/** Freio anti-tempestade: nunca mais de um REST a cada 1 s. */
const REST_MIN_GAP_MS = 1_000;

/**
 * Websocket @ticker da Binance com reconexão exponencial + jitter.
 * Mantém em memória apenas os últimos 180 segundos de leituras cruas; a
 * normalização (1 ponto/s) e a medição de qualidade acontecem em um único
 * lugar (`normalizeTicks`), compartilhado com o motor.
 */
export type BookTop = {
  bid: number | null;
  ask: number | null;
  bidQty: number | null;
  askQty: number | null;
  at: number;
};

export function useLivePrice(symbol: string | null) {
  const [price, setPrice] = useState<number | null>(null);
  const [ticks, setTicks] = useState<RawTick[]>([]);
  const [quality, setQuality] = useState<FeedQuality | null>(null);
  const [book, setBook] = useState<BookTop | null>(null);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  /** Histórico de 180 s já carregado: a janela nasce pronta, sem aquecimento. */
  const [seeded, setSeeded] = useState(false);
  /** Relógio de 1 s: reavalia a janela preenchida mesmo sem negócio novo. */
  const [frame, setFrame] = useState(0);
  const attemptRef = useRef(0);
  /** Par a que os dados guardados pertencem — evita mostrar números do par anterior. */
  const [owner, setOwner] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) return;
    setPrice(null);
    setTicks([]);
    setQuality(null);
    setBook(null);
    setStatus("connecting");
    setSeeded(false);
    setOwner(symbol);
    attemptRef.current = 0;

    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let lastMsgAt = 0;
    let lastRestAt = 0;
    let restInFlight = false;

    const pushPrice = (p: number, time: number, source: NonNullable<RawTick["source"]>) => {
      // Mensagens atrasadas do par anterior (websocket fechando, REST em voo)
      // são descartadas.
      if (closed || !isFinite(p) || p <= 0) return;
      lastMsgAt = Date.now();
      setPrice(p);
      setTicks((prev) => {
        const next = [...prev, { time, price: p, source }];
        const cutoff = Date.now() - WINDOW_MS;
        // Guarda no máximo ~4 leituras cruas por segundo da janela.
        const inWindow = next.filter((t) => t.time >= cutoff);
        return inWindow.length > MAX_POINTS * 4
          ? inWindow.slice(inWindow.length - MAX_POINTS * 4)
          : inWindow;
      });
    };

    // Janela já pronta: o histórico real dos últimos 180 s (velas de 1 s) é
    // carregado de uma vez, com novas tentativas se a Binance recusar, e
    // mesclado em ordem cronológica com o que o websocket já trouxe. Sem isso o
    // painel passaria minutos "aquecendo".
    const seedAbort = new AbortController();
    fetchSeedWindow(symbol, seedAbort.signal)
      .then((history) => {
        if (closed || history.length === 0) return;
        // Alinha as velas ao relógio local (a última vela fechada ≈ 1 s atrás).
        const offset = Date.now() - 1000 - history[history.length - 1]!.time;
        const aligned = history.map((t) => ({ ...t, time: t.time + offset }));
        setTicks((prev) => mergeTicks(aligned, prev));
        const lastPrice = history[history.length - 1]!.price;
        setPrice((p) => p ?? lastPrice);
        setSeeded(true);
        lastMsgAt = Date.now();
      })
      .catch(() => {});

    const connect = () => {
      if (closed) return;
      const s = symbol.toLowerCase();
      ws = new WebSocket(
        `wss://stream.binance.com:9443/stream?streams=${s}@trade/${s}@miniTicker/${s}@bookTicker`,
      );

      ws.onopen = () => {
        attemptRef.current = 0;
        setStatus("live");
      };
      ws.onmessage = (ev) => {
        if (closed) return;
        try {
          type Payload = {
            e?: string;
            c?: string;
            p?: string;
            E?: number;
            T?: number;
            // bookTicker: melhor compra/venda e quantidades.
            b?: string;
            B?: string;
            a?: string;
            A?: string;
          };
          const frame = JSON.parse(ev.data as string) as {
            stream?: string;
            data?: Payload;
          } & Payload;
          const payload: Payload = frame.data ?? frame;
          const isBook = frame.stream?.endsWith("@bookTicker") ?? payload.a != null;
          if (isBook) {
            const bid = Number(payload.b);
            const ask = Number(payload.a);
            if (isFinite(bid) && isFinite(ask) && bid > 0 && ask > 0) {
              setBook({
                bid,
                ask,
                bidQty: isFinite(Number(payload.B)) ? Number(payload.B) : null,
                askQty: isFinite(Number(payload.A)) ? Number(payload.A) : null,
                at: Date.now(),
              });
            }
            return;
          }
          const isTrade = payload.e === "trade" || frame.stream?.endsWith("@trade");
          const p = Number(isTrade ? payload.p : payload.c);
          // Carimbo do relógio LOCAL de recebimento: o relógio da corretora pode
          // estar adiantado/atrasado em relação ao seu computador, e misturar os
          // dois fazia leituras serem descartadas e o preço-alvo congelar.
          const time = Date.now();
          pushPrice(p, time, isTrade ? "trade" : "ticker");
        } catch {
          /* ignore malformed frame */
        }
      };
      ws.onerror = () => ws?.close();
      ws.onclose = () => {
        if (closed) return;
        attemptRef.current += 1;
        setStatus(attemptRef.current > 5 ? "offline" : "reconnecting");
        const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (attemptRef.current - 1));
        // Jitter: evita todos os clientes reconectarem no mesmo instante.
        const delay = base / 2 + Math.random() * (base / 2);
        timer = setTimeout(connect, delay);
      };
    };

    connect();

    // Fallback REST com freio: no máximo um pedido por segundo, e nunca dois
    // em voo ao mesmo tempo.
    const fallback = setInterval(() => {
      const nowMs = Date.now();
      if (closed || restInFlight) return;
      if (nowMs - lastMsgAt < SILENCE_MS || nowMs - lastRestAt < REST_MIN_GAP_MS) return;
      restInFlight = true;
      lastRestAt = nowMs;
      fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { price?: string } | null) => {
          const p = Number(d?.price);
          if (isFinite(p) && p > 0) pushPrice(p, Date.now(), "rest");
        })
        .catch(() => {})
        .finally(() => {
          restInFlight = false;
        });
    }, 300);

    // Qualidade do feed recalculada a cada segundo, mesmo sem tick novo. Os
    // segundos sem negócio entram com o último preço real da corretora, então
    // um par pouco negociado não aparece como "leitura atrasada".
    const qualityTimer = setInterval(() => {
      const now = Date.now();
      setFrame(now);
      setTicks((prev) => {
        const filled = fillGaps(prev, now, WINDOW_MS);
        setQuality(normalizeTicks(filled, now, WINDOW_MS, MAX_POINTS).quality);
        return prev;
      });
    }, 1000);

    // Ao voltar para a aba (ou a internet voltar), o navegador pode ter
    // congelado timers e derrubado o websocket: ressincroniza na hora —
    // reconecta, recarrega os últimos 180 s e força um recálculo.
    const resync = () => {
      if (closed || document.visibilityState === "hidden") return;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        if (timer) clearTimeout(timer);
        attemptRef.current = 0;
        connect();
      }
      fetchSeedWindow(symbol)
        .then((history) => {
          if (closed || history.length === 0) return;
          const offset = Date.now() - 1000 - history[history.length - 1]!.time;
          const aligned = history.map((t) => ({ ...t, time: t.time + offset }));
          setTicks((prev) => mergeTicks(aligned, prev));
          lastMsgAt = Date.now();
        })
        .catch(() => {});
      setFrame(Date.now());
    };
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("focus", resync);
    window.addEventListener("online", resync);

    return () => {
      closed = true;
      seedAbort.abort();
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("focus", resync);
      window.removeEventListener("online", resync);
      clearInterval(fallback);
      clearInterval(qualityTimer);
      if (timer) clearTimeout(timer);
      if (ws) {
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
    };
  }, [symbol]);

  // Janela entregue ao motor com os segundos parados preenchidos pelo último
  // preço real — nada é inventado, só mantido enquanto ninguém negocia.
  const filledTicks = useMemo(
    () => fillGaps(ticks, Date.now(), WINDOW_MS),
    // `frame` força o recálculo a cada segundo.
    [ticks, frame],
  );

  // No render logo após a troca (antes do efeito limpar), nunca entrega os
  // dados do par anterior: tudo volta vazio até chegar o preço do par novo.
  if (owner !== symbol) {
    return { price: null, ticks: [], quality: null, status: "connecting" as LiveStatus, book: null, seeded: false };
  }
  return { price, ticks: filledTicks, quality, status, book, seeded };
}
