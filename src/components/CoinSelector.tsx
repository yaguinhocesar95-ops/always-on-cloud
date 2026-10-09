import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPct, formatPrice, type SymbolInfo } from "@/lib/binance";
import { cn } from "@/lib/utils";

type Props = {
  symbols: SymbolInfo[];
  value: string | null;
  onChange: (symbol: string) => void;
  disabled?: boolean;
};

export function CoinSelector({ symbols, value, onChange, disabled }: Props) {
  const selected = symbols.find((s) => s.symbol === value);
  const label = selected ? `${selected.base}/${selected.quote}` : value;
  return (
    <Select {...(value ? { value } : {})} onValueChange={onChange} disabled={disabled ?? false}>
      <SelectTrigger className="w-full max-w-[240px] font-mono tracking-widest uppercase">
        <SelectValue placeholder="Escolher par">{label || "Escolher par"}</SelectValue>
      </SelectTrigger>
      <SelectContent className="font-mono">
        {symbols.map((s) => (
          <SelectItem key={s.symbol} value={s.symbol} className="uppercase">
            <span>
              {s.base}/{s.quote}
            </span>
            <span className="ml-3 text-xs tabular-nums text-muted-foreground">
              {formatPrice(s.price, s.quote)}
            </span>
            <span
              className={cn(
                "ml-2 text-xs tabular-nums",
                s.changePct >= 0 ? "text-success" : "text-destructive",
              )}
            >
              {formatPct(s.changePct)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
