import { useEffect, useMemo, useState } from "react";
import type { Bet } from "@/hooks/useBets";
import { formatMoney, type DisplayCurrency } from "@/lib/money";
import { LIVE_BLOCK_LABEL } from "@/lib/supremo";
import { conversionText, financialsUsdt, fxStatus, rateText, type FxQuote, type UsdtTotal } from "@/lib/fx-totals";
import {
  bookStats,
  hitRateText,
  readAudit,
  starReport,
  readExposure,
  writeExposure,
  type AuditCycle,
  type ExposureSettings,
} from "@/lib/supremo-live";

/** Painel da trilha Supremo: estatísticas, resultado, exposição e auditoria. */
export function SupremoInsights({
  bets,
  livePrices,
  fx,
}: {
  bets: Bet[];
  livePrices?: Map<string, number> | undefined;
  currency?: DisplayCurrency;
  fx: FxQuote;
}) {
  const stats = useMemo(() => bookStats(bets), [bets]);
  const sr = useMemo(() => starReport(bets), [bets]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  const fin = useMemo(() => financialsUsdt(bets, (s) => livePrices?.get(s) ?? null, fx, now), [bets, livePrices, fx, now]);
  const fxSt = fxStatus(fx, now);
  const excluded = [...fin.realized.excluded, ...fin.unrealized.excluded, ...fin.awaiting.excluded];
  const hasBrl = bets.some((b) => b.stakeCurrency === "BRL");
  const [settings, setSettings] = useState<ExposureSettings>(() => readExposure());
  const [audit, setAudit] = useState<AuditCycle[]>([]);

  useEffect(() => {
    setSettings(readExposure());
    setAudit(readAudit());
    const onAudit = () => setAudit(readAudit());
    const onExp = () => setSettings(readExposure());
    window.addEventListener("supremo-audit", onAudit);
    window.addEventListener("supremo-exposure", onExp);
    return () => {
      window.removeEventListener("supremo-audit", onAudit);
      window.removeEventListener("supremo-exposure", onExp);
    };
  }, []);

  const save = (patch: Partial<ExposureSettings>) => writeExposure({ ...settings, ...patch });
  // Todos os totais em USDT; valores em BRL só entram convertidos por cotação válida.
  const m = (v: number, signed = true) => `${formatMoney(v, "USDT", { signed })} USDT`;

  return (
    <div className="mt-4 space-y-3 font-sans text-xs">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2">
        <Stat label="vitórias" value={stats.wins} tone="text-success" />
        <Stat label="derrotas" value={stats.losses} tone="text-destructive" />
        <Stat label="valendo" value={stats.open} tone="text-primary" />
        <Stat label="aguardando gatilho" value={stats.pending} tone="text-warning" />
        <Stat label="resolvidas" value={stats.resolved} />
        <Stat label="sem desfecho" value={stats.noOutcome} />
      </div>
      <p className="font-mono text-foreground">{hitRateText(stats)}.</p>
      <p className="text-[0.65rem] text-muted-foreground">
        Aguardando gatilho e sem desfecho não entram na taxa de acerto.
      </p>

      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <p className="mb-2 text-[0.65rem] uppercase tracking-wider text-muted-foreground">Taxa real de alvo por estrelinhas</p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(4.25rem,1fr))] gap-2">
          {sr.buckets.map((k) => (
            <div key={k.stars} className="min-w-0 rounded-md border border-border/60 px-1.5 py-1.5 text-center">
              <div className="break-all text-xs leading-tight text-gold" aria-label={`${k.stars} estrelinhas`}>{"★".repeat(k.stars)}</div>
              <div className="font-mono text-sm tabular-nums text-foreground">
                {k.rate == null ? "—" : `${Math.round(k.rate * 100)}%`}
              </div>
              <div className="text-[0.65rem] text-muted-foreground">{k.wins} de {k.wins + k.losses}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 font-mono text-[0.65rem] text-muted-foreground">
          canceladas: {sr.canceladas} · tempo médio até resolver:{" "}
          {sr.tempoMedioResolver == null ? "—" : `${sr.tempoMedioResolver.toFixed(1).replace(".", ",")} min`}
          {sr.semNota > 0 && <> · {sr.semNota} resolvida(s) sem nota</>}
        </p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2">
        <Money label="resultado realizado" hint="só vitórias e derrotas" value={m(fin.realized.total)} />
        <Money label="resultado não realizado" hint="apostas valendo, preço atual" value={m(fin.unrealized.total)} />
        <Money label="aguardando execução" hint="margem antes do gatilho" value={m(fin.awaiting.total, false)} />
        <Money label="combinado provisório" hint="realizado + não realizado" value={m(fin.combined)} />
      </div>
      <div className="rounded-md border border-border bg-muted/20 px-2 py-1.5 font-mono text-[0.65rem]">
        <p>Totais em USDT (moeda-base). {rateText(fx)}.</p>
        <p className="text-muted-foreground">
          Cotação atualizada em: {fx.at ? new Date(fx.at).toLocaleTimeString("pt-BR") : "—"}
          {fxSt !== "ok" && <span className="text-warning"> · {fxSt === "velha" ? "cotação velha" : fxSt === "invalida" ? "cotação inválida" : "aguardando cotação"}{hasBrl ? " — valores em BRL fora dos totais" : ""}</span>}
        </p>
      </div>
      {excluded.length > 0 && (
        <details className="text-warning">
          <summary className="cursor-pointer">{excluded.length} valor(es) fora do total — aguardando cotação</summary>
          <ul className="mt-1 font-mono">
            {excluded.map((x, i) => (
              <li key={x.id + i}>{x.label}: {conversionText(x.value, x.currency, fx, now)} ({x.reason})</li>
            ))}
          </ul>
        </details>
      )}
      {hasBrl && <ConvList title="Conversões BRL → USDT" totals={[fin.realized, fin.unrealized, fin.awaiting]} fx={fx} now={now} />}
      {fin.unpriced > 0 && (
        <p className="text-warning">{fin.unpriced} aposta(s) valendo sem preço atual — fora do não realizado.</p>
      )}

      <details className="rounded-lg border border-border bg-muted/20 p-3">
        <summary className="cursor-pointer font-semibold text-foreground">
          Exposição — {fin.exposure.included.length + fin.exposure.excluded.length} ativa(s) · {m(fin.exposure.total, false)} alavancado
          {fin.exposure.excluded.length > 0 && <span className="text-warning"> ({fin.exposure.excluded.length} fora — aguardando cotação)</span>}
        </summary>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span>sem limite total de apostas ativas</span>
          <label className="flex items-center gap-1">
            máx. por moeda
            <input
              type="number"
              min={1}
              value={settings.maxActivePerCoin}
              onChange={(e) => save({ maxActivePerCoin: Number(e.target.value) })}
              className="w-14 rounded border border-border bg-background px-1 py-0.5"
            />
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={settings.allowRepeat}
              onChange={(e) => save({ allowRepeat: e.target.checked })}
            />
            permitir apostas repetidas
          </label>
        </div>
        {fin.perCoin.length > 0 && (
          <ul className="mt-2 space-y-0.5 font-mono">
            {fin.perCoin.map((c) => (
              <li key={c.symbol}>
                {c.symbol}: {c.count} ativa(s) · {m(c.usdt, false)} · {(c.share * 100).toFixed(0)}% da exposição
              </li>
            ))}
          </ul>
        )}
      </details>

      <details className="rounded-lg border border-border bg-muted/20 p-3">
        <summary className="cursor-pointer font-semibold text-foreground">
          Auditoria da seleção — {audit.length} ciclo(s)
        </summary>
        {audit.length === 0 ? (
          <p className="mt-2 text-muted-foreground">Nenhum ciclo automático registrado ainda.</p>
        ) : (
          <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">
            {audit.map((c) => (
              <details key={c.id} className="rounded border border-border/60 p-2">
                <summary className="cursor-pointer">
                  {new Date(c.at).toLocaleTimeString("pt-BR")} ·{" "}
                  {c.chosen ? <span className="text-primary">escolhida {c.chosen}</span> : <span className="text-warning">nenhuma escolhida</span>}{" "}
                  · {c.coins.length} moedas
                </summary>
                {c.note && <p className="mt-1 text-warning">{c.note}</p>}
                <table className="mt-1 w-full font-mono text-[0.62rem]">
                  <thead className="text-muted-foreground">
                    <tr className="text-left">
                      <th>moeda</th><th>índice</th><th>s no ímã</th><th>cobertura</th><th>situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.coins.map((x) => (
                      <tr key={x.symbol} className={x.symbol === c.chosen ? "text-primary" : ""}>
                        <td>{x.symbol}</td>
                        <td>{x.index}</td>
                        <td>{x.magnetSeconds}</td>
                        <td>{(x.coverage * 100).toFixed(0)}%</td>
                        <td>
                          {x.symbol === c.chosen
                            ? "escolhida"
                            : x.blocks.length
                              ? x.blocks.map((b) => `${b} (${LIVE_BLOCK_LABEL[b]})`).join("; ")
                              : x.exposure ?? "liberada (outra moeda teve prioridade)"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ))}
          </div>
        )}
      </details>
      <p className="text-[0.62rem] text-muted-foreground">Simulação local, sem dinheiro real. Lucro no histórico não valida a estratégia.</p>
    </div>
  );
}

function ConvList({ title, totals, fx, now }: { title: string; totals: UsdtTotal[]; fx: FxQuote; now: number }) {
  const rows = totals.flatMap((t) => t.included).filter((x) => x.currency === "BRL");
  if (!rows.length) return null;
  return (
    <details className="text-[0.65rem]">
      <summary className="cursor-pointer text-muted-foreground">{title} ({rows.length})</summary>
      <ul className="mt-1 font-mono">
        {rows.map((x, i) => (
          <li key={x.id + i}>{x.label}: {conversionText(x.value, x.currency, fx, now)}</li>
        ))}
      </ul>
    </details>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="min-w-0 break-words rounded-md border border-border bg-muted/20 px-2 py-1.5">
      <div className={`font-mono text-base tabular-nums ${tone ?? "text-foreground"}`}>{value}</div>
      <div className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function Money({ label, hint, value }: { label: string; hint: string; value: string }) {
  return (
    <div className="min-w-0 break-words rounded-md border border-border bg-muted/20 px-2 py-1.5">
      <div className="font-mono text-sm tabular-nums text-foreground">{value}</div>
      <div className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-[0.55rem] text-muted-foreground">{hint}</div>
    </div>
  );
}
