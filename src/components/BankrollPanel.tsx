import { Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMoney, type DisplayCurrency } from "@/lib/money";
import { NET_LOSS_PCT, NET_WIN_PCT } from "@/hooks/useBets";

type Props = {
  initial: number;
  stake: number;
  leverage: number;
  currency: DisplayCurrency;
  leveraged: boolean;
  realizedPnl: number;
  openPnl: number;
  usdtBrl: number | null;
  onInitial: (v: number) => void;
  onStake: (v: number) => void;
  onLeveraged: (v: boolean) => void;
  onCurrency: (c: DisplayCurrency) => void;
};

export function BankrollPanel({
  initial,
  stake,
  leverage,
  currency,
  leveraged,
  realizedPnl,
  openPnl,
  usdtBrl,
  onInitial,
  onStake,
  onLeveraged,
  onCurrency,
}: Props) {
  const balance = initial + realizedPnl;
  const projected = balance + openPnl;
  const perBetWin = stake * leverage * NET_WIN_PCT;
  const perBetLoss = stake * leverage * NET_LOSS_PCT;

  return (
    <section className="tv-panel p-5">
      <div className="relative z-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="tv-headline flex items-center gap-2 text-[0.95rem] text-foreground">
            <Wallet className="size-4" /> Sua banca
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onLeveraged(!leveraged)}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold tracking-widest uppercase transition-colors",
                leveraged
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "inline-block size-2 rounded-full",
                  leveraged ? "bg-primary" : "bg-muted-foreground/40",
                )}
              />
              Alavancado {leverage}x
            </button>
            <div className="flex overflow-hidden rounded-full border border-border">
              {(["BRL", "USDT"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onCurrency(c)}
                  className={cn(
                    "px-4 py-1 text-xs font-bold tracking-widest uppercase transition-colors",
                    currency === c
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c === "BRL" ? "R$ BRL" : "USDT"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label={`Valor inicial (${currency})`}
            value={initial}
            onChange={onInitial}
            hint="Quanto você tem para começar"
          />
          <Field
            label={`Valor por aposta (${currency})`}
            value={stake}
            onChange={onStake}
            disabled={leveraged}
            hint={
              leveraged
                ? `Travado: valor inicial × ${leverage} (alavancado)`
                : `Margem por entrada · alavancagem ${leverage}x`
            }
          />
        </div>

        <dl className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-3 border-t border-border pt-4">
          <Stat label="Saldo atual" value={formatMoney(balance, currency)} tone="neutral" />
          <Stat
            label="Resultado fechado"
            value={formatMoney(realizedPnl, currency, { signed: true })}
            tone={realizedPnl >= 0 ? "up" : "down"}
          />
          <Stat
            label="Em aberto"
            value={formatMoney(openPnl, currency, { signed: true })}
            tone={openPnl >= 0 ? "up" : "down"}
          />
          <Stat label="Saldo projetado" value={formatMoney(projected, currency)} tone="neutral" />
        </dl>

        <p className="mt-3 font-sans text-[0.7rem] text-muted-foreground">
          Cada acerto de +0,55% bruto com {leverage}x rende{" "}
          <span className="text-success">{formatMoney(perBetWin, currency, { signed: true })}</span>{" "}
          líquido e cada limite de perda de −0,55% custa{" "}
          <span className="text-destructive">
            {formatMoney(perBetLoss, currency, { signed: true })}
          </span>
          .
          {usdtBrl != null && (
            <> Câmbio usado: 1 USDT = R$ {usdtBrl.toFixed(2).replace(".", ",")}.</>
          )}
        </p>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[0.65rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </span>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        value={value === 0 ? "" : value}
        placeholder="0,00"
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        disabled={disabled}
        className={cn(
          "mt-1 h-11 bg-card font-mono text-lg tabular-nums",
          disabled && "cursor-not-allowed opacity-60",
        )}
      />
      <span className="mt-1 block text-[0.65rem] text-muted-foreground">{hint}</span>
    </label>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "up" | "down" | "neutral";
}) {
  return (
    <div className="tv-plate min-w-0 break-words px-3 py-2">
      <dt className="text-[0.6rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "font-mono text-lg tabular-nums",
          tone === "up" && "text-success",
          tone === "down" && "text-destructive",
          tone === "neutral" && "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
