import { useEffect, useRef, useState } from "react";
import { Ban, Check, ChevronDown, Clock, Hourglass, Trash2, X, Zap } from "lucide-react";
import { betPnl, betTriggerDistancePct, betVariation, type Bet, type BetEventType, type BetStatus } from "@/hooks/useBets";
import type { PriceMap } from "@/hooks/useAllTickerPrices";
import { rotuloDesfecho } from "@/lib/supremo-economics";
import { isStale, priceAgeMs } from "@/lib/supremo-live";
import { convertMoney, formatMoney, formatQuotePrice, type DisplayCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";
import { BetRuler } from "@/components/BetRuler";
import { StarRating } from "@/components/StarRating";

export const STATUS_META: Record<BetStatus, { label: string; cls: string; icon: typeof Check }> = {
  pending: { label: "Aguardando gatilho", cls: "border-info/40 bg-info/10 text-info", icon: Hourglass },
  open: { label: "Valendo", cls: "border-gold/50 bg-gold-soft text-gold", icon: Zap },
  win: { label: "Ganhou", cls: "border-success/40 bg-success/10 text-success", icon: Check },
  loss: { label: "Perdeu", cls: "border-destructive/40 bg-destructive/10 text-destructive", icon: X },
  cancelled: { label: "Cancelada", cls: "border-border bg-muted text-muted-foreground", icon: Ban },
};

const fmtPctBR = (v: number, d = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d).replace(".", ",")}%`;
const fmtTime = (t: number | null | undefined) => (t ? new Date(t).toLocaleTimeString("pt-BR") : "—");

/** Bilhete de aposta usado em todas as listas. */
export function BetTicket({
  bet,
  livePrices,
  currency,
  usdtBrl,
  onRemove,
  compact = false,
}: {
  bet: Bet;
  livePrices?: Map<string, number> | undefined;
  currency: DisplayCurrency;
  usdtBrl?: number | null | undefined;
  onRemove?: (id: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Destaque de 1,5 s quando o status muda.
  const prevStatus = useRef(bet.status);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prevStatus.current === bet.status) return;
    prevStatus.current = bet.status;
    setFlash(true);
    const id = setTimeout(() => setFlash(false), 1500);
    return () => clearTimeout(id);
  }, [bet.status]);

  const symbolPrice = livePrices?.get(bet.symbol) ?? null;
  const updatedAt = (livePrices as PriceMap | undefined)?.times?.get(bet.symbol) ?? null;
  const nowMs = Date.now();
  const age = priceAgeMs(updatedAt, nowMs);
  const stale = isStale(updatedAt, nowMs, 5000);
  const pairCurrency: DisplayCurrency = bet.quote === "BRL" || bet.symbol.endsWith("BRL") ? "BRL" : "USDT";
  const frozen = bet.displayCurrency === currency && bet.fxAtCreate != null && isFinite(bet.fxAtCreate);
  const toDisplay = (v: number | null, from: string, useFrozen = true): number | null => {
    if (v == null) return null;
    if (useFrozen && frozen && from === pairCurrency) return v * bet.fxAtCreate!;
    return convertMoney(v, from, currency, usdtBrl ?? null);
  };
  const fmtBet = (v: number | null) => formatQuotePrice(toDisplay(v, pairCurrency), currency);
  const fmtLive = (v: number | null) => formatQuotePrice(toDisplay(v, pairCurrency, false), currency);
  const fmtAmt = (v: number | null, from: string, signed = false) =>
    formatMoney(toDisplay(v, from, false), currency, { signed });

  const live = bet.status === "open" ? symbolPrice : null;
  const pct = betVariation(bet, live) * 100;
  const money = betPnl(bet, live);
  const pendingDist = betTriggerDistancePct(bet, symbolPrice);
  const active = bet.status === "pending" || bet.status === "open";
  const meta = STATUS_META[bet.status];
  const Icon = meta.icon;
  const base = bet.symbol.replace(/(USDT|BRL)$/, "");
  const rulerCurrent =
    bet.status === "win" ? bet.target : bet.status === "loss" ? bet.stop : active ? symbolPrice : null;
  const stars = bet.starsAtCreate ?? bet.supremoMeta?.stars;
  const resultTone =
    bet.status === "pending" || bet.status === "cancelled"
      ? "text-muted-foreground"
      : money >= 0
        ? "text-success"
        : "text-destructive";
  const subtitle =
    bet.status === "win" || bet.status === "loss"
      ? rotuloDesfecho(bet, bet.status)
      : bet.status === "cancelled"
        ? (bet.cancelReason ?? null)
        : null;

  const badge = (
    <span
      data-testid="bet-status"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-caption font-semibold",
        meta.cls,
      )}
    >
      <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
      {meta.label}
      {bet.status === "cancelled" && bet.cancelReason && <span className="sr-only"> · {bet.cancelReason}</span>}
    </span>
  );

  const removeBtn = onRemove && (
    <button
      type="button"
      onClick={() => onRemove(bet.id)}
      aria-label="Excluir aposta"
      title="Excluir aposta"
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
    >
      <Trash2 className="size-4" strokeWidth={1.75} />
    </button>
  );

  const result =
    bet.status === "pending" ? (
      <span className="ypx-num text-body text-info">
        {pendingDist == null ? "—" : `${fmtPctBR(pendingDist, 3)} até o gatilho`}
      </span>
    ) : bet.status === "cancelled" ? (
      <span className="ypx-num text-body text-muted-foreground">—</span>
    ) : (
      <span className={cn("ypx-num inline-flex items-baseline gap-2", resultTone)}>
        <span className={cn("font-bold", compact ? "text-body" : "text-title")}>
          {fmtAmt(money, bet.stakeCurrency ?? currency, true)}
        </span>
        <span className="text-caption">{fmtPctBR(pct, 3)}</span>
      </span>
    );

  if (compact) {
    return (
      <li
        data-testid="bet-ticket"
        data-status={bet.status}
        className={cn(
          "flex min-h-11 items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-1.5",
          bet.status === "open" && "ypx-breathe",
          flash && "ypx-highlight",
        )}
      >
        <span className="ypx-num w-16 shrink-0 text-caption text-muted-foreground">
          {new Date(bet.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        </span>
        <span className="w-20 shrink-0 truncate font-semibold text-foreground">{base}</span>
        {badge}
        <div className="hidden min-w-24 flex-1 sm:block">
          <BetRuler stop={bet.stop} trigger={bet.triggerPrice} target={bet.target} current={rulerCurrent} fmt={fmtBet} compact />
        </div>
        <span className="ml-auto">{result}</span>
        {removeBtn}
      </li>
    );
  }

  return (
    <li
      data-testid="bet-ticket"
      data-status={bet.status}
      className={cn(
        "rounded-lg border bg-surface-2 transition-colors",
        bet.status === "open" ? "ypx-breathe border-gold/50" : "border-border",
        bet.status === "cancelled" && "opacity-80",
        flash && "ypx-highlight",
      )}
    >
      <div className="flex items-center gap-3 px-4 pt-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-3 font-display text-body font-bold text-gold" aria-hidden>
          {base.slice(0, 1)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold text-foreground">
            {base}
            <span className="font-normal text-muted-foreground">/{bet.quote || pairCurrency}</span>
          </p>
          <p className="ypx-num text-caption text-muted-foreground">{fmtTime(bet.createdAt)}</p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {badge}
          {removeBtn}
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-3">
        <div className="space-y-1">
          {stars != null && <StarRating value={stars} size="xs" />}
          {bet.stake > 0 && (
            <p className="ypx-num text-caption text-muted-foreground">
              {fmtAmt(bet.stake, bet.stakeCurrency ?? currency)} × {bet.leverage}x
            </p>
          )}
        </div>
        <div className="text-right">
          {result}
          {active && (
            <p className={cn("ypx-num text-caption", stale ? "text-warning" : "text-muted-foreground")}>
              agora {fmtLive(symbolPrice)}
              {stale && ` · sem preço ao vivo (${age == null ? "sem leitura" : `há ${Math.round(age / 1000)} s`})`}
            </p>
          )}
        </div>
      </div>
      {subtitle && <p className="px-4 pt-1 text-caption text-muted-foreground">{subtitle}</p>}

      <div className="px-4 pt-3">
        <BetRuler
          stop={bet.stop}
          trigger={bet.triggerPrice}
          target={bet.target}
          current={rulerCurrent}
          fmt={fmtBet}
          showMarker={bet.status !== "cancelled"}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-caption text-muted-foreground">
        <span className="ypx-num inline-flex items-center gap-1">
          <Clock className="size-3.5" strokeWidth={1.75} aria-hidden /> criada {fmtTime(bet.createdAt)}
        </span>
        <span className="ypx-num">armada {fmtTime(bet.armedAt)}</span>
        <span className="ypx-num">resolvida {fmtTime(bet.resolvedAt)}</span>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-foreground hover:bg-surface-3"
        >
          Detalhes
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      {open && (
        <div className="border-t border-border px-4 py-3 text-caption text-muted-foreground">
          <div className="ypx-num grid grid-cols-2 gap-x-3 gap-y-1">
            <span>ID: {bet.id.slice(0, 8)}</span>
            <span>moeda: {bet.symbol}</span>
            <span>preço de entrada: {bet.armedAt ? fmtBet(bet.entryPrice) : "—"}</span>
            <span>combinação: {bet.combo ?? "padrão"}</span>
          </div>
          <ol className="mt-2 space-y-1 border-l border-gold/40 pl-3">
            {(bet.events ?? [{ t: bet.createdAt, type: "criada" as const }]).map((e, i) => (
              <li key={i} className="ypx-num">
                {fmtTime(e.t)} · {EVENT_LABEL[e.type]}
                {"price" in e && e.price != null && <> · {fmtBet(e.price)}</>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </li>
  );
}

const EVENT_LABEL: Record<BetEventType, string> = {
  criada: "aposta criada",
  gatilho: "gatilho atingido",
  entrada: "entrada registrada",
  preco: "atualização de preço",
  alvo: "alvo atingido",
  stop: "stop atingido",
  encerrada: "aposta encerrada",
  cancelada: "aposta cancelada",
};
