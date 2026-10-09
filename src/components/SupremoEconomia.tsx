import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Bet } from "@/hooks/useBets";
import { useActiveCombo } from "@/hooks/useActiveCombo";
import type { FxQuote } from "@/lib/fx-totals";
import { combinacaoAtiva } from "@/lib/supremo-combo";
import { fmtPct, payoffText, resumoEconomia } from "@/lib/supremo-economics";
import { GROUP_LABEL, buildSlots, controlReport, type ControlReport, type GroupKey, type Slot } from "@/lib/supremo-control";
import { getMinuteCandles24h, mapSettled } from "@/lib/supremo-data";
import { cn } from "@/lib/utils";

const usd = (v: number | null | undefined) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}US$ ${Math.abs(v).toFixed(2).replace(".", ",")}`);

type Props = { bets: Bet[]; symbols: string[]; fx: FxQuote | null | undefined };

export function SupremoEconomia({ bets, symbols, fx }: Props) {
  const combo = useActiveCombo();
  const ref = combinacaoAtiva(combo);
  const r = useMemo(() => resumoEconomia(bets, ref, fx, Date.now()), [bets, ref.alvoBruto, ref.stopBruto, fx]); // eslint-disable-line react-hooks/exhaustive-deps

  const cards: [string, string, string?][] = [
    ["Ganho líquido médio", `+${fmtPct(r.ganhoLiquidoMedio)}`, "text-success"],
    ["Perda líquida média", `−${fmtPct(r.perdaLiquidaMedia)}`, "text-destructive"],
    ["Payoff", payoffText(r.payoff)],
    ["Ponto de equilíbrio", fmtPct(r.breakEven, 0), "text-warning"],
    ["Acerto atual (Wilson)", r.taxa == null ? "—" : `${fmtPct(r.taxa, 0)} (${fmtPct(r.wilson?.low, 0)}–${fmtPct(r.wilson?.high, 0)})`],
    ["Baseline aleatório", fmtPct(r.baseline, 0)],
    ["Vantagem sobre o acaso", r.vantagem == null ? "—" : `${r.vantagem >= 0 ? "+" : "−"}${fmtPct(Math.abs(r.vantagem), 0)}`, r.vantagem != null && r.vantagem < 0 ? "text-destructive" : "text-success"],
    ["Expectativa por aposta", r.expectativaPct == null ? "—" : `${fmtPct(r.expectativaPct, 3)} · ${usd(r.expectativaUsdt)}`, (r.expectativaPct ?? 0) < 0 ? "text-destructive" : "text-success"],
    ["Lucro acumulado", usd(r.lucroUsdt), r.lucroUsdt < 0 ? "text-destructive" : "text-success"],
    ["Vitórias para recuperar", r.vitoriasParaRecuperar == null ? "—" : String(r.vitoriasParaRecuperar)],
  ];

  return (
    <section className="rounded-2xl border border-gold/40 bg-card p-4 md:p-5">
      <h2 className="tv-display text-lg text-foreground">Economia da aposta</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        {r.resolvidas} resolvidas ({r.ganhas} ganhas, {r.perdidas} perdidas) · combinação em uso: alvo +{fmtPct(ref.alvoBruto)} / stop −{fmtPct(ref.stopBruto)} bruto, taxa {fmtPct(ref.taxaIdaVolta)} ida e volta.
      </p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-2">
        {cards.map(([k, v, cls]) => (
          <div key={k} className="min-w-0 break-words rounded-lg border border-border p-2.5">
            <p className="text-[0.68rem] text-muted-foreground">{k}</p>
            <p className={cn("font-mono text-sm text-foreground", cls)}>{v}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm text-foreground">{r.leitura}</p>
      {r.abaixoDoAcaso && (
        <p className="mt-2 flex items-center gap-1.5 rounded border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
          <AlertTriangle className="size-4" /> O índice ainda não supera o acaso nesta amostra.
        </p>
      )}
      <ControlGroup symbols={symbols} />
    </section>
  );
}

function ControlGroup({ symbols }: { symbols: string[] }) {
  const combo = useActiveCombo();
  const [busy, setBusy] = useState<string | null>(null);
  const [rep, setRep] = useState<ControlReport | null>(null);
  const [n, setN] = useState(0);

  const run = async () => {
    const list = symbols.slice(0, 8);
    if (!list.length) return void toast.error("Aguarde a primeira leitura das moedas.");
    setBusy("Buscando velas…");
    try {
      let done = 0;
      const res = await mapSettled(list, (s) => getMinuteCandles24h(s, Date.now()), () => setBusy(`Velas: ${++done}/${list.length}`));
      const slots: Slot[] = [];
      res.forEach((x, i) => { if (x.ok) slots.push(...buildSlots(list[i]!, x.value)); });
      setRep(controlReport(slots, combinacaoAtiva(combo)));
      setN(slots.length);
    } catch (e) {
      toast.error(`Falha no grupo de controle: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">Grupo de controle (últimas 24 h, velas de 1 min)</p>
          <p className="text-xs text-muted-foreground">Mesma combinação, gatilho, validade de 1 h e mesma vela = derrota. Só informa; não muda a seleção ao vivo.</p>
        </div>
        <Button size="sm" variant="outline" onClick={run} disabled={!!busy}>{busy ?? "Rodar grupo de controle"}</Button>
      </div>
      {rep && (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-[0.72rem]">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border"><th className="p-1.5">Grupo</th><th className="p-1.5">Amostra</th><th className="p-1.5">Acerto (Wilson)</th><th className="p-1.5">Expectativa líquida</th></tr>
              </thead>
              <tbody>
                {(["a", "b", "c", "d"] as GroupKey[]).map((k) => {
                  const g = rep.groups[k];
                  return (
                    <tr key={k} className="border-b border-border/50 font-mono">
                      <td className="p-1.5 font-sans">({k}) {GROUP_LABEL[k]}</td>
                      <td className="p-1.5">{g.amostra}</td>
                      <td className="p-1.5">{fmtPct(g.taxa, 0)} ({fmtPct(g.wilson?.low, 0)}–{fmtPct(g.wilson?.high, 0)})</td>
                      <td className={cn("p-1.5", (g.expectativa ?? 0) < 0 ? "text-destructive" : "text-success")}>{fmtPct(g.expectativa, 3)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 font-mono text-[0.72rem] text-muted-foreground">
            {n} oportunidades · diferença (a) − (d): {rep.diffAD ? `${fmtPct(rep.diffAD.diff, 0)} (IC ${fmtPct(rep.diffAD.low, 0)} a ${fmtPct(rep.diffAD.high, 0)})` : "—"}
          </p>
          <p className={cn("mt-1 text-sm font-medium", rep.preditivo ? "text-success" : "text-warning")}>{rep.conclusao}.</p>
        </>
      )}
    </div>
  );
}
