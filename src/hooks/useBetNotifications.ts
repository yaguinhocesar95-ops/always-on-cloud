import { useEffect, useRef, useState } from "react";
import { betPnl, betVariation, type Bet } from "@/hooks/useBets";

export type NotifGroup = { label: string; bets: Bet[] };

const UPDATE_MS = 15_000;

function fmt(n: number) {
  const d = n >= 100 ? 2 : n >= 1 ? 4 : 6;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Posição do preço entre limite (0%) e alvo (100%) em barra de texto. */
function bar(b: Bet, px: number | null) {
  if (px == null || b.target <= b.stop) return "";
  const pos = Math.min(1, Math.max(0, (px - b.stop) / (b.target - b.stop)));
  const n = 10;
  const i = Math.round(pos * n);
  const cells = Array.from({ length: n + 1 }, (_, k) => (k === i ? "●" : k < i ? (pos < 0.5 ? "🟥" : "🟩") : "▫"));
  return `🔴 ${cells.join("")} 🟢`;
}

function body(b: Bet, px: number | null) {
  const v = betVariation(b, px) * 100;
  const pnl = betPnl(b, px);
  const lines = [
    `Atual ${px != null ? fmt(px) : "—"} · Entrada ${fmt(b.entryPrice)}`,
    `Alvo ${fmt(b.target)} · Limite ${fmt(b.stop)}`,
    `Variação ${v >= 0 ? "+" : ""}${v.toFixed(2)}% · Resultado ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} ${b.stakeCurrency}`,
  ];
  const br = bar(b, px);
  if (br) lines.push(br);
  return lines.join("\n");
}

/**
 * Mostra notificações do navegador com as apostas ativas (acionadas) quando a
 * aba está em segundo plano. Uma notificação por aposta, atualizada no lugar.
 */
export function useBetNotifications(groups: NotifGroup[], priceFor: (symbol: string) => number | null) {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const shown = useRef(new Map<string, Notification>());
  const lastAt = useRef(new Map<string, { t: number; status: string }>());
  const data = useRef({ groups, priceFor });
  data.current = { groups, priceFor };

  useEffect(() => {
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);

  const request = async () => {
    if (typeof Notification === "undefined") return;
    setPermission(await Notification.requestPermission());
  };

  useEffect(() => {
    if (permission !== "granted") return;
    const closeAll = () => {
      shown.current.forEach((n) => n.close());
      shown.current.clear();
      lastAt.current.clear();
    };
    const run = (force = false) => {
      if (document.visibilityState === "visible") return closeAll();
      const now = Date.now();
      const active = new Set<string>();
      for (const g of data.current.groups) {
        for (const b of g.bets) {
          if (b.status !== "open") continue;
          active.add(b.id);
          const prev = lastAt.current.get(b.id);
          if (!force && prev && prev.status === b.status && now - prev.t < UPDATE_MS) continue;
          const px = data.current.priceFor(b.symbol);
          const pnl = betPnl(b, px);
          try {
            const n = new Notification(`${pnl >= 0 ? "🟢" : "🔴"} ${g.label} · ${b.symbol}`, {
              body: body(b, px),
              tag: `bet-${b.id}`,
              silent: !!prev,
              requireInteraction: true,
            } as NotificationOptions);
            n.onclick = () => {
              window.focus();
              n.close();
            };
            shown.current.set(b.id, n);
            lastAt.current.set(b.id, { t: now, status: b.status });
          } catch {
            /* notificação indisponível */
          }
        }
      }
      for (const [id, n] of shown.current) {
        if (!active.has(id)) {
          n.close();
          shown.current.delete(id);
          lastAt.current.delete(id);
        }
      }
    };
    const onVis = () => run(true);
    document.addEventListener("visibilitychange", onVis);
    const tick = setInterval(() => run(), 3000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(tick);
      closeAll();
    };
  }, [permission]);

  return { permission, request };
}
