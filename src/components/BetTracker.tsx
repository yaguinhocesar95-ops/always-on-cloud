import { useState } from "react";
import { BetTicket } from "@/components/BetTicket";
import { useUiLayout } from "@/hooks/useUiLayout";
import { rotuloDesfecho } from "@/lib/supremo-economics";
import { Hourglass, Star, Target, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { betPnl, betTriggerDistancePct, betVariation, type Bet, type BetEventType, type BetStatus } from "@/hooks/useBets";
import type { PriceMap } from "@/hooks/useAllTickerPrices";
import { bookStats, hitRateText, isStale, priceAgeMs } from "@/lib/supremo-live";
import { convertMoney, formatMoney, formatQuotePrice, type DisplayCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";

type Props = {
  bets: Bet[];
  stars: number;
  losses: number;
  livePrice: number | null;
  /** Preços ao vivo de todos os pares (websocket), para mostrar o valor atual da moeda de cada lance. */
  livePrices?: Map<string, number> | undefined;
  currency: DisplayCurrency;
  usdtBrl?: number | null | undefined;
  fmtPrice: (v: number | null) => string;
  canPlace: boolean;
  blockedReason: string | null;
  autoOn: boolean;
  onToggleAuto: (v: boolean) => void;
  autoCountdown: string | null;
  onPlace: () => void;
  onClear: () => void;
  onRemove: (id: string) => void;
  title?: string;
  description?: React.ReactNode;
  autoLabel?: string;
  hidePlace?: boolean;
  hideAuto?: boolean;
  extra?: React.ReactNode;
};

export function BetTracker({
  bets,
  stars,
  losses,
  livePrice,
  livePrices,
  currency,
  usdtBrl,
  fmtPrice,
  canPlace,
  blockedReason,
  autoOn,
  onToggleAuto,
  autoCountdown,
  onPlace,
  onClear,
  onRemove,
  title = "Validar aposta",
  description,
  autoLabel = "Validar automaticamente a cada 10 minutos",
  hidePlace = false,
  hideAuto = false,
  extra,
}: Props) {
  const [filter, setFilter] = useState<"all" | BetStatus>("all");
  const density = useUiLayout().ui.density;

  const stats = bookStats(bets);
  const pendingCount = bets.filter((b) => b.status === "pending").length;
  const openCount = bets.filter((b) => b.status === "open").length;

  const visibleBets =
    filter === "all" ? bets : bets.filter((b) => b.status === filter);

  const FILTERS: {
    key: "all" | BetStatus;
    label: string;
    count: number;
    icon: React.ReactNode;
    selectedClass: string;
  }[] = [
    {
      key: "all",
      label: "todos",
      count: bets.length,
      icon: null,
      selectedClass: "bg-primary text-primary-foreground border-primary",
    },
    {
      key: "pending",
      label: "aguardando",
      count: pendingCount,
      icon: <Hourglass className="size-3" />,
      selectedClass: "border-warning bg-warning/15 text-warning",
    },
    {
      key: "open",
      label: "valendo",
      count: openCount,
      icon: <span className="size-2 rounded-full bg-primary" />,
      selectedClass: "border-primary bg-primary/15 text-primary",
    },
    {
      key: "win",
      label: "estrelinhas",
      count: stars,
      icon: <Star className="tv-star size-3" />,
      selectedClass: "border-success bg-success/15 text-success",
    },
    {
      key: "loss",
      label: "erros",
      count: losses,
      icon: <X className="size-3" />,
      selectedClass: "border-destructive bg-destructive/15 text-destructive",
    },
  ];

  return (
    <section className="tv-panel p-6">
      <div className="relative z-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="tv-headline text-[0.95rem] text-foreground">{title}</h2>
            <p className="mt-1 font-sans text-xs text-muted-foreground">
              {description ?? <>A aposta espera o preço cair até a entrada. Depois disso, vale a recuperação até o
              preço-alvo (+0,55% bruto, +0,35% líquido) = estrelinha; −0,55% = erro.</>}
            </p>
          </div>
          {!hidePlace && <Button
            variant="gold"
            onClick={onPlace}
            disabled={!canPlace}
            className="h-12 px-6 text-[0.8rem]"
          >
            <Target className="size-4" />
            VALIDAR AGORA
          </Button>}
        </div>

        {blockedReason && <p className="mt-2 font-sans text-xs text-warning">{blockedReason}</p>}

        {!hideAuto && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <label className="flex cursor-pointer items-center gap-2 font-sans text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={autoOn}
              onChange={(e) => onToggleAuto(e.target.checked)}
              className="size-4 accent-[hsl(var(--primary))]"
            />
            {autoLabel}
          </label>
          <span className="font-mono text-xs tabular-nums text-foreground">
            {autoOn ? `próxima em ${autoCountdown ?? "—"}` : "automático desligado"}
          </span>
        </div>
        )}

        {extra}

        <div className="mt-5 flex flex-wrap items-center gap-6 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <Star className="tv-star size-5" />
            <span className="tv-display text-2xl tabular-nums text-gold">{stars}</span>
            <span className="text-[0.6rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">
              estrelinhas
            </span>
          </div>
          <div className="font-mono text-xs text-muted-foreground">
            <span className="text-destructive">{losses}</span> erros ·{" "}
            {hitRateText(stats)}
            {pendingCount > 0 && (
              <>
                {" · "}
                <span className="text-warning">{pendingCount} aguardando gatilho</span>
              </>
            )}
          </div>
          {bets.length > 0 && (
            <button
              onClick={onClear}
              className="ml-auto inline-flex items-center gap-1 font-mono text-[0.65rem] tracking-widest text-muted-foreground uppercase hover:text-foreground"
            >
              <X className="size-3" /> limpar
            </button>
          )}
        </div>

        {bets.length > 0 && (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              {FILTERS.filter((f) => f.key === "all" || f.count > 0).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[0.62rem] tracking-[0.14em] uppercase transition-colors",
                    filter === f.key
                      ? f.selectedClass
                      : "border-border bg-muted/20 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.icon}
                  {f.label}
                  <span className="tabular-nums opacity-70">{f.count}</span>
                </button>
              ))}
            </div>

            <p className="mt-3 font-mono text-[0.65rem] tracking-widest text-muted-foreground uppercase">
              {filter === "all" ? "histórico completo" : FILTERS.find((f) => f.key === filter)?.label} ·{" "}
              {visibleBets.length} aposta{visibleBets.length > 1 ? "s" : ""}
              {filter !== "all" && visibleBets.length !== bets.length && (
                <span className="normal-case tracking-normal"> · de {bets.length} no total</span>
              )}
            </p>
            <ul className="mt-2 max-h-[28rem] space-y-2 overflow-y-auto pr-1">
              {visibleBets.map((b) => (
                <li key={b.id}>
                  <BetTicket
                    bet={b}
                    livePrices={livePrices}
                    currency={currency}
                    usdtBrl={usdtBrl}
                    onRemove={onRemove}
                    compact={density === "compact"}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

