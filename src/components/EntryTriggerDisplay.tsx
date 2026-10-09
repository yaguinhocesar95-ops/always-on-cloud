import { AlertTriangle, Layers } from "lucide-react";
import {
  BIN_COUNT,
  FEE_ROUND_TRIP_PCT,
  GROSS_TARGET_PCT,
  MIN_TICKS,
  NET_TARGET_PCT,
  VELOCITY_SIGMA,
  type ScalpEngine,
} from "@/lib/scalp";
import { cn } from "@/lib/utils";

type Props = {
  engine: ScalpEngine;
  fmtPrice: (v: number | null) => string;
  /** Moeda selecionada — a mesma exibida em "Último preço". */
  symbol: string;
  /** Horário (ms) da última leitura real de preço recebida. */
  lastUpdate?: number | null;
};

const pct = (v: number) => `${(v * 100).toFixed(2).replace(".", ",")}%`;

export function EntryTriggerDisplay({ engine, fmtPrice, symbol, lastUpdate = null }: Props) {
  const {
    danger,
    entryTrigger,
    magnetPrice,
    requiredDropPct,
    rangePct,
    clusterHits,
    clusterSharePct,
    cluster,
    grossTarget,
    stop,
    velocitySigma,
    warmupPct,
    bins,
    price,
    reason,
    ticks,
  } = engine;
  const warming = !danger && entryTrigger == null && reason === "warmup";
  const noTrigger = !danger && entryTrigger == null && reason !== "warmup";
  const maxCount = bins.reduce((m, b) => Math.max(m, b.count), 0);

  return (
    <section className={cn("tv-panel p-6 transition-colors", danger && "border-destructive/60")}>
      <div className="relative z-10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="tv-headline text-[0.95rem] text-foreground">
              Preço-alvo · faixa mais repetida
            </h2>
            <div className="mt-0.5 font-mono text-[0.65rem] font-bold tracking-[0.08em] text-primary uppercase">
              {symbol}
            </div>
            <div className="mt-1 flex items-center gap-1.5 font-mono text-[0.65rem] text-muted-foreground">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  lastUpdate != null && Date.now() - lastUpdate < 5000
                    ? "bg-success animate-pulse"
                    : "bg-warning",
                )}
              />
              {lastUpdate == null
                ? "aguardando preços…"
                : `recalculado a cada 1 s · último preço há ${Math.max(0, Math.round((Date.now() - lastUpdate) / 1000))}s`}
            </div>
          </div>
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[0.6rem] tracking-[0.08em] uppercase",
              danger
                ? "border-destructive/50 bg-destructive/10 text-destructive"
                : "border-border bg-muted/40 text-muted-foreground",
            )}
          >
            {danger ? <AlertTriangle className="size-3" /> : <Layers className="size-3" />}
            {danger ? "cauda extrema" : `${BIN_COUNT} faixas de preço`}
          </span>
        </div>

        {danger ? (
          <div className="mt-4">
            <p className="tv-display text-[1.7rem] leading-tight text-destructive md:text-[2.2rem]">
              PERIGO: VELOCIDADE EXTREMA. NÃO COMPRE.
            </p>
            <p className="mt-2 font-sans text-xs text-muted-foreground">
              Queda de {velocitySigma == null ? "—" : velocitySigma.toFixed(1)}σ em menos de 5 s —
              acima do limite de {VELOCITY_SIGMA}σ. O cálculo está invalidado até o mercado
              desacelerar.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-3">
              <div className="text-[0.65rem] font-bold tracking-[0.08em] text-success uppercase">
                Preço-alvo (valor mais frequente)
              </div>
              <div className="tv-glow-number text-[2.8rem] leading-none tabular-nums md:text-[4.4rem]">
                {fmtPrice(magnetPrice)}
              </div>
              <p className="mt-2 font-sans text-xs text-muted-foreground">
                Faixa em que o mercado mais bateu nos últimos 180 s
                {clusterHits != null ? ` (${clusterHits} toques` : ""}
                {clusterSharePct != null ? ` · ${clusterSharePct.toFixed(0)}% da janela)` : ")"} —
                uma referência estatística para onde o preço tende a voltar.
              </p>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="tv-plate px-3 py-3">
                <div className="text-[0.65rem] font-bold tracking-[0.08em] text-primary uppercase">
                  Queda necessária para entrar
                </div>
                <div className="mt-1 font-mono text-xl tabular-nums text-foreground">
                  {fmtPrice(entryTrigger)}
                </div>
                <div className="mt-1 font-mono text-[0.7rem] text-destructive">
                  {requiredDropPct == null ? "—" : `−${requiredDropPct.toFixed(3)}% do preço atual`}
                </div>
              </div>
              <div className="tv-plate px-3 py-3">
                <div className="text-[0.65rem] font-bold tracking-[0.08em] text-destructive uppercase">
                  Limite de perda
                </div>
                <div className="mt-1 font-mono text-xl tabular-nums text-foreground">
                  {fmtPrice(stop)}
                </div>
                <div className="mt-1 font-mono text-[0.7rem] text-muted-foreground">
                  −{pct(GROSS_TARGET_PCT)} da entrada
                </div>
              </div>
            </div>

            <p className="mt-3 font-sans text-xs text-muted-foreground">
              Cálculo reverso: entrada = preço-alvo ÷ 1,0055. Da entrada até o alvo são +
              {pct(GROSS_TARGET_PCT)} brutos ({pct(FEE_ROUND_TRIP_PCT)} de taxas, +
              {pct(NET_TARGET_PCT)} líquido). Alvo{" "}
              <span className="text-success">{fmtPrice(grossTarget)}</span>.
            </p>

            {warming && (
              <p className="mt-2 font-sans text-xs text-warning">
                Carregando o histórico dos últimos 180 s — {(warmupPct * 100).toFixed(0)}% pronto
                ({ticks} de {MIN_TICKS} leituras).
              </p>
            )}

            {noTrigger && (
              <p className="mt-2 font-sans text-xs text-warning">
                {reason === "flat"
                    ? `Este par não se moveu nos últimos 180 s (preço parado em ${fmtPrice(price)}) — sem faixa repetida para servir de referência.`
                  : reason === "below-entry"
                    ? `O preço atual (${fmtPrice(price)}) já está abaixo da entrada calculada — a aposta só vale quando o mercado estiver acima dela e cair até lá.`
                    : `Ainda não há uma faixa repetida forte o suficiente na janela de 180 s.`}
              </p>
            )}
          </>
        )}

        {bins.length > 0 && !danger && (
          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between font-mono text-[0.65rem] tracking-[0.08em] text-muted-foreground uppercase">
              <span>mínimo {fmtPrice(engine.low)}</span>
              <span>frequência por faixa</span>
              <span>máximo {fmtPrice(engine.high)}</span>
            </div>
            <div className="flex h-16 items-end gap-[3px]">
              {bins.map((b) => {
                const isCluster = cluster != null && b.index === cluster.bin.index;
                const isCurrent = price != null && price >= b.low && price <= b.high;
                const h = maxCount > 0 ? Math.max(3, (b.count / maxCount) * 100) : 3;
                return (
                  <div
                    key={b.index}
                    title={`${b.count} toques`}
                    className={cn(
                      "flex-1 rounded-sm transition-all",
                      isCluster
                        ? "bg-primary"
                        : isCurrent
                          ? "bg-foreground/60"
                          : "bg-muted-foreground/25",
                    )}
                    style={{ height: `${h}%` }}
                  />
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-2 border-t border-border pt-4">
          <Metric
            label="queda até a entrada"
            value={requiredDropPct == null ? "—" : `−${requiredDropPct.toFixed(3)}%`}
            tone="down"
          />
          <Metric label="toques no preço-alvo" value={clusterHits == null ? "—" : `${clusterHits}×`} />
          <Metric
            label="amplitude 180s"
            value={rangePct == null ? "—" : `${rangePct.toFixed(3)}%`}
          />
          <Metric
            label="velocidade 5s"
            value={velocitySigma == null ? "—" : `${velocitySigma.toFixed(2)}σ`}
            tone={danger ? "down" : undefined}
          />
        </div>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "down" | "up" | undefined;
}) {
  return (
    <div className="tv-plate min-w-0 break-words px-3 py-2.5">
      <div className="text-[0.65rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-sm tabular-nums",
          tone === "down" ? "text-destructive" : tone === "up" ? "text-success" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}
