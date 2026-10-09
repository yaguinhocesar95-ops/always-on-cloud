import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { fetchPairs } from "@/lib/binance";
import { getMinuteCandlesDays, mapSettled } from "@/lib/supremo-data";
import { buildSlots, type Slot } from "@/lib/supremo-control";
import { EXP_LAB_MIN_SAMPLE, FEE_DEFAULT, FEE_SENSITIVITY, NENHUMA_TEXT, expRows, rowFromTally, tallyGrid, type ExpRow, type Tallies } from "@/lib/supremo-expectancy-lab";
import { fmtPct } from "@/lib/supremo-economics";
import { writeActiveCombo } from "@/lib/supremo-combo";
import { cn } from "@/lib/utils";

const COINS = 6;

export function ExpectancyLab() {
  const [days, setDays] = useState(7);
  const [feePct, setFeePct] = useState(FEE_DEFAULT * 100);
  const [busy, setBusy] = useState<string | null>(null);
  const [tallies, setTallies] = useState<Tallies | null>(null);
  const [nSlots, setNSlots] = useState(0);
  const [pick, setPick] = useState<ExpRow | null>(null);
  const fee = Math.max(0, feePct) / 100;

  const rows = useMemo(() => (tallies ? expRows(tallies, fee) : []), [tallies, fee]);
  const aprovadas = rows.filter((r) => r.aprovada);

  const run = async () => {
    setBusy("Buscando moedas…");
    try {
      const pairs = (await fetchPairs()).slice(0, COINS);
      let done = 0;
      const res = await mapSettled(pairs, (p) => getMinuteCandlesDays(p.symbol, Date.now(), days), () => setBusy(`Velas: ${++done}/${pairs.length}`));
      const slots: Slot[] = [];
      res.forEach((r, i) => { if (r.ok) slots.push(...buildSlots(pairs[i]!.symbol, r.value)); });
      setBusy("Simulando combinações…");
      await new Promise((r) => setTimeout(r, 0));
      setTallies(tallyGrid(slots));
      setNSlots(slots.length);
    } catch (e) {
      toast.error(`Falha no laboratório: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mb-6 rounded-lg border border-border p-3">
      <h3 className="text-sm font-semibold text-foreground">Por expectativa líquida (velas de 1 min)</h3>
      <p className="mb-2 text-xs text-muted-foreground">
        Faixa mais visitada da hora anterior, mesma regra de gatilho, 1 h de validade e mesma vela = derrota. Treino = 70% iniciais do período; validação = 30% finais.
      </p>
      <div className="mb-3 flex flex-wrap items-end gap-3 text-xs">
        <label className="grid gap-1">Dias de velas (1–7)
          <Input type="number" min={1} max={7} value={days} onChange={(e) => setDays(Math.max(1, Math.min(7, Number(e.target.value) || 1)))} className="h-8 w-20" />
        </label>
        <label className="grid gap-1">Taxa de ida e volta (%)
          <Input type="number" step={0.01} min={0} value={feePct} onChange={(e) => setFeePct(Number(e.target.value))} className="h-8 w-24" />
        </label>
        <Button size="sm" onClick={run} disabled={!!busy}>{busy ?? "Rodar grade"}</Button>
        {tallies && <span className="text-muted-foreground">{nSlots} oportunidades · {rows.length} combinações</span>}
      </div>

      {tallies && (
        <>
          {aprovadas.length === 0 ? (
            <p className="mb-2 rounded border border-warning/40 bg-warning/10 p-2 text-xs text-warning">{NENHUMA_TEXT}.</p>
          ) : (
            <p className="mb-2 text-xs text-success">{aprovadas.length} combinação(ões) com expectativa positiva no treino e na validação (amostra ≥ {EXP_LAB_MIN_SAMPLE} em cada).</p>
          )}
          {rows[0] && (
            <p className="mb-2 font-mono text-[0.7rem] text-muted-foreground">
              Sensibilidade da melhor ({fmtPct(rows[0].alvoBruto)} / −{fmtPct(rows[0].stopBruto)}):{" "}
              {[fee, ...FEE_SENSITIVITY].map((f) => {
                const t = tallies.items.find((i) => i.alvo === rows[0]!.alvoBruto && i.stop === rows[0]!.stopBruto)!.t;
                return `taxa ${fmtPct(f)} → ${fmtPct(rowFromTally(rows[0]!.alvoBruto, rows[0]!.stopBruto, t, f).total.expectativa, 3)}`;
              }).join(" · ")}
            </p>
          )}
          <div className="max-h-96 overflow-auto">
            <table className="w-full min-w-[56rem] text-left text-[0.7rem]">
              <thead className="sticky top-0 bg-card text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="p-1">Alvo / stop bruto</th><th className="p-1">Amostra</th><th className="p-1">Acerto</th><th className="p-1">Equilíbrio</th>
                  <th className="p-1">Acaso</th><th className="p-1">Vantagem</th><th className="p-1">Expectativa</th><th className="p-1">Expect. (Wilson inf.)</th>
                  <th className="p-1">Treino</th><th className="p-1">Validação</th><th className="p-1" />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 80).map((r) => (
                  <tr key={`${r.alvoBruto}-${r.stopBruto}`} className={cn("border-b border-border/50 font-mono", r.aprovada && "bg-success/10 text-success")}>
                    <td className="p-1">+{fmtPct(r.alvoBruto)} / −{fmtPct(r.stopBruto)}</td>
                    <td className="p-1">{r.total.amostra}</td>
                    <td className="p-1">{fmtPct(r.total.taxa, 0)}</td>
                    <td className="p-1">{fmtPct(r.breakEven, 0)}</td>
                    <td className="p-1">{fmtPct(r.baseline, 0)}</td>
                    <td className="p-1">{fmtPct(r.vantagem, 0)}</td>
                    <td className="p-1">{fmtPct(r.total.expectativa, 3)}</td>
                    <td className="p-1">{fmtPct(r.total.expectativaLow, 3)}</td>
                    <td className="p-1">{r.treino.amostra} · {fmtPct(r.treino.expectativa, 3)}</td>
                    <td className="p-1">{r.validacao.amostra} · {fmtPct(r.validacao.expectativa, 3)}</td>
                    <td className="p-1"><Button size="sm" variant="outline" className="h-6 px-2 text-[0.65rem]" onClick={() => setPick(r)}>Usar esta combinação</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <AlertDialog open={!!pick} onOpenChange={(o) => !o && setPick(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usar alvo +{fmtPct(pick?.alvoBruto)} / stop −{fmtPct(pick?.stopBruto)}?</AlertDialogTitle>
            <AlertDialogDescription>
              Ponto de equilíbrio: {fmtPct(pick?.breakEven, 0)} · expectativa líquida por aposta: {fmtPct(pick?.total.expectativa, 3)} (treino {fmtPct(pick?.treino.expectativa, 3)}, validação {fmtPct(pick?.validacao.expectativa, 3)}). Vale só para as próximas apostas Supremo; as já gravadas não mudam.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pick) return;
                writeActiveCombo({ targetPct: pick.alvoBruto, stopPct: pick.stopBruto, mode: "percentual" });
                toast.success("Combinação trocada para as próximas apostas Supremo.");
                setPick(null);
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
