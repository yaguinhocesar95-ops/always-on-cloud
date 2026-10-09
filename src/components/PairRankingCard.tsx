/**
 * Card de apoio à decisão: qual dos pares monitorados está, agora, com o
 * cenário mais limpo para tentar uma validação.
 *
 * Não é sinal novo e não cria gatilho nenhum. Tudo que aparece aqui é
 * agregação transparente do que o motor e os filtros já calcularam para cada
 * par — cada linha mostra o número medido que gerou a nota.
 */

import { useState } from "react";
import { ChevronDown, Clock, Lock, Trophy, Wifi, WifiOff } from "lucide-react";

import { SIGNAL_LABEL, rankingHeadline, type PairRank } from "@/lib/pair-ranking";
import { cn } from "@/lib/utils";

type StreamInfo = {
  status: "conectando" | "ao-vivo" | "reconectando";
  reconnects: number;
  lastFrameAt: number | null;
  stale: Set<string>;
  lastTickAt: Map<string, number>;
};

type Props = {
  ranked: PairRank[];
  /** Saúde do fluxo ao vivo (reconexão automática + defasagem por par). */
  stream: StreamInfo;
  /** Par aberto no terminal agora (destaque visual). */
  selected: string;
  onSelect: (symbol: string) => void;
};

const fmtScore = (v: number | null) => (v == null ? "—" : (v * 100).toFixed(0));

function RankMedal({ rank, state }: { rank: number; state: PairRank["state"] }) {
  return (
    <span
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full border font-display text-xs font-bold tabular-nums",
        rank === 1 && state === "ativo"
          ? "border-primary/30 bg-primary/10 text-primary"
          : state === "ativo"
            ? "border-border bg-muted/40 text-muted-foreground"
            : "border-border bg-muted/30 text-muted-foreground/60",
      )}
    >
      {rank}
    </span>
  );
}

function StateLine({ state, reasons }: { state: PairRank["state"]; reasons?: string[] }) {
  if (state === "bloqueado") {
    return (
      <span
        className="flex items-center gap-1 text-[0.62rem] font-medium uppercase tracking-wider text-destructive"
        title={reasons && reasons.length > 0 ? `bloqueado por: ${reasons.join(", ")}` : undefined}
      >
        <Lock className="size-2.5" />
        {SIGNAL_LABEL[state]}
        {reasons && reasons.length > 0 && (
          <span className="normal-case tracking-normal text-muted-foreground">
            · {reasons[0]}
          </span>
        )}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-[0.62rem] font-medium uppercase tracking-wider",
        state === "ativo" ? "text-success" : "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          state === "ativo" ? "animate-pulse bg-success" : "bg-muted-foreground",
        )}
      />
      {SIGNAL_LABEL[state]}
    </span>
  );
}

const STREAM_LABEL: Record<StreamInfo["status"], string> = {
  conectando: "conectando",
  "ao-vivo": "ao vivo",
  reconectando: "reconectando…",
};

function secondsAgo(at: number | undefined) {
  if (at == null) return null;
  return Math.max(0, Math.round((Date.now() - at) / 1000));
}

function StaleBadge({ at }: { at: number | undefined }) {
  const secs = secondsAgo(at);
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[0.58rem] font-medium uppercase tracking-wider text-destructive">
      <Clock className="size-2.5" />
      dados atrasados{secs == null ? "" : ` · ${secs}s`}
    </span>
  );
}

export function PairRankingCard({ ranked, stream, selected, onSelect }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const top = ranked[0];
  const totalFilters = top ? top.filtersMeasurable : 0;
  const total = ranked.length;

  return (
    <section className="tv-panel overflow-hidden p-0">
      <div className="relative z-10">
        {/* Cabeçalho compacto */}
        <div className="border-b border-border/50 p-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h2 className="tv-headline flex items-center gap-1.5 text-[0.68rem] tracking-[0.18em] text-primary uppercase">
              <Trophy className="size-3.5" />
              Par mais adequado agora
            </h2>
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.62rem] font-medium",
                  stream.status === "ao-vivo"
                    ? "bg-success/10 text-success"
                    : "bg-destructive/10 text-destructive",
                )}
                title={
                  stream.reconnects > 0
                    ? `${stream.reconnects} reconexão(ões) automática(s) nesta sessão`
                    : "fluxo ao vivo dos pares"
                }
              >
                {stream.status === "ao-vivo" ? (
                  <Wifi className="size-2.5" />
                ) : (
                  <WifiOff className="size-2.5" />
                )}
                {STREAM_LABEL[stream.status]}
              </span>
              <span className="rounded-full bg-success/10 px-2 py-0.5 text-[0.62rem] font-medium text-success">
                {total} pares · {totalFilters} filtros
              </span>
            </div>
          </div>
          <p className="text-[0.68rem] leading-snug text-muted-foreground">
            {rankingHeadline(ranked)}
          </p>
          {stream.stale.size > 0 && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[0.65rem] leading-snug text-destructive">
              <Clock className="size-3 shrink-0" />
              {stream.stale.size === total
                ? "Nenhum par está recebendo negócio novo — o fluxo é reconectado automaticamente e o histórico recarregado."
                : `${stream.stale.size} de ${total} pares sem negócio novo: a nota deles está com dados atrasados.`}
            </p>
          )}
        </div>

        {/* Linhas compactas com medalhas — rolável quando há muitos pares */}
        <div className="max-h-[24rem] divide-y divide-border/40 overflow-y-auto">
          {ranked.map((r, i) => {
            const isOpen = open === r.symbol;
            const blocked = r.state === "bloqueado";
            return (
              <div
                key={r.symbol}
                className={cn(
                  "transition-colors",
                  blocked && "opacity-55",
                  r.symbol === selected && "bg-primary/[0.04]",
                )}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <RankMedal rank={i + 1} state={r.state} />
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onSelect(r.symbol)}
                      className="text-sm font-bold text-foreground transition-colors hover:text-primary"
                    >
                      {r.base}/{r.quote}
                    </button>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StateLine state={r.state} reasons={r.blocked} />
                      {stream.stale.has(r.symbol) && (
                        <StaleBadge at={stream.lastTickAt.get(r.symbol)} />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="text-right">
                      <div className="font-mono text-sm font-bold text-foreground tabular-nums">
                        Nota {fmtScore(r.score)}
                        <span className="text-[0.62rem] font-normal text-muted-foreground">
                          /100
                        </span>
                      </div>
                      <div className="font-mono text-[0.6rem] text-muted-foreground tabular-nums">
                        {r.filtersPass}/{r.filtersMeasurable} filtros
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Detalhar ${r.base}/${r.quote}`}
                      onClick={() => setOpen(isOpen ? null : r.symbol)}
                      className="text-muted-foreground/60 transition-colors hover:text-foreground"
                    >
                      <ChevronDown
                        className={cn("size-4 transition-transform", isOpen && "rotate-180")}
                      />
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="space-y-1.5 border-t border-border/50 px-4 py-2.5">
                    {r.components.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-baseline justify-between gap-3 text-xs"
                      >
                        <span className="text-muted-foreground">
                          {c.label}{" "}
                          <span className="font-mono text-[0.65rem]">
                            (peso {(c.weight * 100).toFixed(0)}%)
                          </span>
                        </span>
                        <span className="text-right font-mono text-foreground tabular-nums">
                          {c.value == null ? "não mensurável" : fmtScore(c.value)}
                        </span>
                      </div>
                    ))}
                    {r.components.map((c) => (
                      <p key={`${c.id}-detail`} className="text-[0.7rem] text-muted-foreground">
                        {c.label}: {c.detail}
                      </p>
                    ))}
                    {r.blocked.length > 0 && (
                      <p className="text-[0.7rem] text-destructive">
                        bloqueios agora: {r.blocked.join("; ")}
                      </p>
                    )}
                    <p className="text-[0.7rem] text-muted-foreground">
                      último negócio recebido:{" "}
                      {secondsAgo(stream.lastTickAt.get(r.symbol)) == null
                        ? "nenhum nesta sessão"
                        : `há ${secondsAgo(stream.lastTickAt.get(r.symbol))} s`}
                      {stream.reconnects > 0 &&
                        ` · ${stream.reconnects} reconexão(ões) automática(s) do fluxo`}
                    </p>
                    <p className="text-[0.7rem] text-muted-foreground">
                      nota calculada sobre {(r.measuredWeight * 100).toFixed(0)}% do peso total (o
                      resto não é mensurável neste instante)
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Nota de rodapé */}
        <div className="border-t border-border/50 bg-black/20 px-4 py-3">
          <p className="text-center text-[0.62rem] leading-relaxed text-muted-foreground/80 italic">
            Os {total} pares são avaliados sem o livro de ofertas — diferença entre compra e venda,
            liquidez e variação de execução valem só no par aberto.
            {top?.mode === "stable-cluster"
              ? " No agrupamento estável, quem pontua melhor nos filtros lidera."
              : " A entrada segue decidida pelo motor."}
          </p>
        </div>
      </div>
    </section>
  );
}
