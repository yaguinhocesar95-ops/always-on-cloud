import { useEffect, useRef, useState } from "react";
import type { BookTop, LiveStatus } from "@/hooks/useLivePrice";
import { cn } from "@/lib/utils";

type Props = {
  price: number | null;
  fmtPrice: (v: number | null) => string;
  status: LiveStatus;
  /** Horário (ms) da última leitura real de preço. */
  lastUpdate?: number | null;
  /** Melhor compra/venda: muda o tempo todo, mesmo sem negócio novo. */
  book?: BookTop | null;
};

export function LivePriceTicker({ price, fmtPrice, status, lastUpdate, book }: Props) {
  const prev = useRef<number | null>(null);
  const [dir, setDir] = useState<"up" | "down" | "flat">("flat");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (price == null) return;
    if (prev.current != null && price !== prev.current) {
      setDir(price > prev.current ? "up" : "down");
    }
    prev.current = price;
  }, [price]);

  const label: Record<LiveStatus, string> = {
    connecting: "conectando",
    live: "ao vivo",
    reconnecting: "reconectando",
    offline: "sem conexão",
  };

  const ageSec = lastUpdate != null ? Math.max(0, Math.round((now - lastUpdate) / 1000)) : null;
  const ageText =
    ageSec == null ? null : ageSec <= 1 ? "atualizado agora" : `atualizado há ${ageSec}s`;

  return (
    <div className="tv-screen flex flex-wrap items-center justify-between gap-x-6 gap-y-4 px-6 py-7 md:px-9 md:py-8">
      <div className="min-w-0">
        <div className="text-[0.68rem] font-medium tracking-[0.14em] text-muted-foreground uppercase">
          Último preço
        </div>
        <div
          className={cn(
            "tv-display mt-2 text-[2.6rem] leading-[0.95] tabular-nums transition-colors duration-300 md:text-[3.6rem]",
            dir === "flat" && "text-foreground",
            dir === "up" && "text-success",
            dir === "down" && "text-destructive",
          )}
        >
          {fmtPrice(price)}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[0.72rem] text-muted-foreground tabular-nums">
          {ageText && <span>{ageText}</span>}
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-[0.62rem] font-medium tracking-[0.16em] text-muted-foreground uppercase">
        <span
          className={cn(
            "inline-block size-1.5 rounded-full",
            status === "live" ? "animate-pulse bg-success" : "bg-warning",
          )}
        />
        {label[status]}
      </span>
    </div>
  );
}
