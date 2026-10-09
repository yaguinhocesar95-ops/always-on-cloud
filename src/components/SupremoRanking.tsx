import { useEffect, useMemo, useRef, useState } from "react";
import { useActiveCombo } from "@/hooks/useActiveCombo";
import { useShadow } from "@/hooks/useShadow";
import { combinacaoAtiva } from "@/lib/supremo-combo";
import { breakEvenDasApostas } from "@/lib/supremo-economics";
import { resumoEpisodios } from "@/lib/supremo-episodes";
import { resumoSombra } from "@/lib/supremo-shadow";
import { ArrowDown, ArrowRight, ArrowUp, Download, Star } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Bet } from "@/hooks/useBets";
import type { ScoredRow } from "@/hooks/supremoScoring";
import { formatPrice } from "@/lib/binance";
import { LIVE_BLOCK_LABEL } from "@/lib/supremo";
import { WhyNoBet } from "@/components/WhyNoBet";
import { readAudit, type AuditCycle } from "@/lib/supremo-live";
import { playNotificationSound } from "@/lib/notification-sounds";
import type { FxQuote } from "@/lib/fx-totals";
import {
  SNAPSHOT_KEY,
  appendSnapshots,
  leituraPlacar,
  placarValidacao,
  META_SAMPLE,
  placarPorEstrelas,
  rankingApostas,
  rankingMoedas,
  resumoGeral,
  toCsv,
  type BetRow,
  type CoinInput,
  type Snapshot,
  type Trend,
} from "@/lib/supremo-ranking";
import { cn } from "@/lib/utils";

type Props = {
  bets: Bet[];
  scored: ScoredRow[];
  nextPick: string | null;
  scannedAt: number | null;
  livePrices: Map<string, number>;
  fx: FxQuote;
};

const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d).replace(".", ",")}%`);
const usd = (v: number | null | undefined) => (v == null ? "—" : `${v >= 0 ? "+" : ""}US$ ${v.toFixed(2).replace(".", ",")}`);
const dur = (ms: number | null | undefined) => {
  if (ms == null) return "—";
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

function readSnaps(): Snapshot[] {
  try {
    const v = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function Stars({ n, size = 12 }: { n: number | null; size?: number }) {
  if (n == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex" aria-label={`${n} estrelinha(s)`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} width={size} height={size} className={i <= Math.round(n) ? "fill-gold text-gold" : "text-muted-foreground/40"} />
      ))}
    </span>
  );
}

function TrendIcon({ t }: { t: Trend }) {
  if (t === "subiu") return <ArrowUp className="size-3.5 text-success" />;
  if (t === "desceu") return <ArrowDown className="size-3.5 text-destructive" />;
  if (t === "estavel") return <ArrowRight className="size-3.5 text-muted-foreground" />;
  return <span className="text-muted-foreground">·</span>;
}

function StatusBadge({ s }: { s: string }) {
  const cls = s.startsWith("Bloqueada")
    ? "border-warning/40 bg-warning/10 text-warning"
    : s === "Aposta ativa"
      ? "border-primary/40 bg-primary/10 text-primary"
      : s === "Será a próxima aposta"
        ? "border-success/40 bg-success/10 text-success"
        : "border-border text-muted-foreground";
  return <span className={cn("inline-block max-w-[16rem] truncate rounded border px-1.5 py-0.5 text-[0.68rem]", cls)} title={s}>{s}</span>;
}

function ProgressBar({ row }: { row: BetRow }) {
  const p = row.progress;
  const pos = p?.pos ?? null;
  return (
    <div className="relative h-2 w-full rounded-full bg-gradient-to-r from-destructive/30 via-muted to-success/30">
      {pos != null && (
        <span
          className={cn("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background", pos >= 0.5 ? "bg-success" : "bg-destructive")}
          style={{ left: `${pos * 100}%` }}
        />
      )}
    </div>
  );
}

export function SupremoRanking({ bets, scored, nextPick, scannedAt, livePrices, fx }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [audit, setAudit] = useState<AuditCycle[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"todas" | "ativas" | "ganhas" | "perdidas" | "canceladas">("todas");
  const [starFilter, setStarFilter] = useState<number | null>(null);
  const [order, setOrder] = useState<"recentes" | "progresso" | "resultado">("recentes");

  useEffect(() => {
    setSnaps(readSnaps());
    setAudit(readAudit());
    const onA = () => setAudit(readAudit());
    window.addEventListener("supremo-audit", onA);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.removeEventListener("supremo-audit", onA);
      clearInterval(id);
    };
  }, []);

  const coins: CoinInput[] = useMemo(
    () =>
      scored.map((r) => ({
        symbol: r.symbol,
        score: r.score ?? null,
        stars: r.stars ?? null,
        price: livePrices.get(r.symbol) ?? r.price,
        trigger: r.plan?.trigger ?? null,
        blocks: r.blocks.map((b) => b in LIVE_BLOCK_LABEL ? LIVE_BLOCK_LABEL[b as keyof typeof LIVE_BLOCK_LABEL] : b),
        touches: r.report ? { h1: r.report.toquesNoIma[1], h3: r.report.toquesNoIma[3], h6: r.report.toquesNoIma[6] } : null,
        cycles: r.report ? { wins: r.report.principal.alvos, n: r.report.principal.alvos + r.report.principal.stops } : null,
        dentro: r.report?.esperado.dentro ?? null,
      })),
    [scored, livePrices],
  );

  const priceFor = (s: string) => livePrices.get(s) ?? null;
  const moedas = useMemo(
    () => rankingMoedas({ coins, bets, snapshots: snaps, audit, nextPick, fx, now }),
    [coins, bets, snaps, audit, nextPick, fx, now],
  );

  // A cada ciclo (nova varredura), grava snapshot enxuto e destaca quem subiu de estrelinhas.
  const prevStars = useRef(new Map<string, number>());
  useEffect(() => {
    if (!scannedAt || moedas.length === 0) return;
    const add: Snapshot[] = moedas.flatMap((m) =>
      m.score == null ? [] : [{ t: scannedAt, symbol: m.symbol, score: m.score, stars: m.stars ?? 0, status: m.status }],
    );
    const next = appendSnapshots(readSnaps().filter((s) => s.t !== scannedAt), add, Date.now());
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(next));
    } catch {
      /* storage cheio */
    }
    setSnaps(next);
    const up = new Set<string>();
    for (const m of moedas) {
      const p = prevStars.current.get(m.symbol);
      if (p != null && m.stars != null && m.stars > p) up.add(m.symbol);
      if (m.stars != null) prevStars.current.set(m.symbol, m.stars);
    }
    if (up.size) {
      setFlash(up);
      playNotificationSound("confirmacao");
      setTimeout(() => setFlash(new Set()), 1500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannedAt]);

  // Destaque rápido quando uma aposta resolve.
  const prevStatus = useRef(new Map<string, string>());
  const [betFlash, setBetFlash] = useState<string | null>(null);
  useEffect(() => {
    for (const b of bets) {
      const p = prevStatus.current.get(b.id);
      if (p && p !== b.status && (b.status === "win" || b.status === "loss")) {
        setBetFlash(b.id);
        setTimeout(() => setBetFlash(null), 1500);
      }
      prevStatus.current.set(b.id, b.status);
    }
  }, [bets]);

  const apostas = useMemo(() => {
    let r = rankingApostas(bets, priceFor, fx, now);
    if (filter === "ativas") r = r.filter((x) => x.bet.status === "pending" || x.bet.status === "open");
    if (filter === "ganhas") r = r.filter((x) => x.bet.status === "win");
    if (filter === "perdidas") r = r.filter((x) => x.bet.status === "loss");
    if (filter === "canceladas") r = r.filter((x) => x.bet.status === "cancelled");
    if (starFilter != null) r = r.filter((x) => x.stars != null && Math.round(x.stars) === starFilter);
    if (order === "progresso") r = [...r].sort((a, b) => (b.progress?.pos ?? -1) - (a.progress?.pos ?? -1));
    if (order === "resultado") r = [...r].sort((a, b) => (b.netUsdt ?? -Infinity) - (a.netUsdt ?? -Infinity));
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bets, livePrices, fx, now, filter, starFilter, order]);

  const activeCombo = useActiveCombo();
  const breakEven = useMemo(() => breakEvenDasApostas(bets, combinacaoAtiva(activeCombo)), [bets, activeCombo]);
  const placar = useMemo(() => placarPorEstrelas(bets, fx, now, breakEven), [bets, fx, now, breakEven]);
  const eps = useMemo(() => resumoEpisodios(bets, fx, now), [bets, fx, now]);
  const shadowStore = useShadow(bets, fx);
  const sombra = useMemo(() => resumoSombra(bets, shadowStore), [bets, shadowStore]);
  const resumo = useMemo(() => resumoGeral(bets, fx, now), [bets, fx, now]);
  const valid = useMemo(() => placarValidacao(bets, fx, now, breakEven), [bets, fx, now, breakEven]);
  const leitura = leituraPlacar(placar.bands);

  const sel = selected ? scored.find((r) => r.symbol === selected) : null;
  const selSnaps = selected
    ? snaps.filter((s) => s.symbol === selected).map((s) => ({ hora: new Date(s.t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }), score: s.score }))
    : [];

  const exportApostas = () =>
    download(
      "supremo-apostas.csv",
      toCsv(
        ["moeda", "criada", "estrelinhas", "pontuacao", "status", "progresso", "resultado_pct", "resultado_usdt"],
        apostas.map((r) => [r.bet.symbol, new Date(r.bet.createdAt).toISOString(), r.stars, r.score, r.status, r.progress ? (r.progress.pos * 100).toFixed(1) : null, r.netPct != null ? (r.netPct * 100).toFixed(3) : null, r.netUsdt?.toFixed(2) ?? null]),
      ),
    );
  const exportPlacar = () =>
    download(
      "supremo-placar.csv",
      toCsv(
        ["estrelinhas", "total", "resolvidas", "ganhas", "perdidas", "canceladas", "taxa", "wilson", "lucro_total_usdt", "lucro_medio_usdt", "tempo_mediano_min", "vs_equilibrio"],
        placar.bands.map((b) => [b.stars, b.total, b.resolvidas, b.ganhas, b.perdidas, b.canceladas, b.taxa?.toFixed(3) ?? null, b.wilsonLow?.toFixed(3) ?? null, b.lucroTotal, b.lucroMedio, b.tempoMedianoMs != null ? Math.round(b.tempoMedianoMs / 60_000) : null, b.vsEquilibrio]),
      ),
    );

  return (
    <section className="rounded-2xl border border-gold/40 bg-card p-4 md:p-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="tv-display text-lg text-foreground">Placar de Estrelinhas</h2>
          <p className="text-[0.75rem] text-muted-foreground">Acompanhamento das moedas e apostas Supremo por estrelinhas.</p>
        </div>
        <div className="flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
          <Star className="size-4 fill-gold text-gold" /> {resumo.estrelinhas} conquistadas
        </div>
      </div>

      <Tabs defaultValue="moedas">
        <TabsList>
          <TabsTrigger value="moedas">Moedas</TabsTrigger>
          <TabsTrigger value="apostas">Apostas</TabsTrigger>
          <TabsTrigger value="placar">Placar</TabsTrigger>
        </TabsList>

        <TabsContent value="moedas">
          {scannedAt == null ? (
            <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : moedas.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma moeda pontuada no último ciclo.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-left text-[0.75rem]">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="p-1.5">Moeda</th><th className="p-1.5">Estrelinhas</th><th className="p-1.5">Pontuação</th><th className="p-1.5">Média 6 h</th>
                    <th className="p-1.5">Status</th><th className="p-1.5">Até gatilho</th><th className="p-1.5">Toques 1/3/6 h</th><th className="p-1.5">Ciclos</th>
                    <th className="p-1.5">Comportamento</th><th className="p-1.5">Histórico</th>
                  </tr>
                </thead>
                <tbody>
                  {moedas.map((m) => (
                    <tr
                      key={m.symbol}
                      onClick={() => setSelected(selected === m.symbol ? null : m.symbol)}
                      className={cn("cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/40", flash.has(m.symbol) && "bg-gold/20", selected === m.symbol && "bg-muted/50")}
                    >
                      <td className="p-1.5 font-medium text-foreground">{m.symbol}</td>
                      <td className="p-1.5"><Stars n={m.stars} /></td>
                      <td className="p-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="w-6 font-mono">{m.score ?? "—"}</span>
                          <TrendIcon t={m.trend} />
                          <div className="h-1 w-14 rounded bg-muted"><div className="h-1 rounded bg-gold" style={{ width: `${m.score ?? 0}%` }} /></div>
                        </div>
                      </td>
                      <td className="p-1.5 font-mono">{m.avgStars6h?.toFixed(1).replace(".", ",") ?? "—"}</td>
                      <td className="p-1.5"><StatusBadge s={m.status} /></td>
                      <td className={cn("p-1.5 font-mono", m.withinLimit ? "text-success" : "text-muted-foreground")}>{pct(m.distTrigger, 2)}</td>
                      <td className="p-1.5 font-mono">{m.touches ? `${m.touches.h1}/${m.touches.h3}/${m.touches.h6}` : "—"}</td>
                      <td className="p-1.5 font-mono">{m.cycles ? `${m.cycles.wins} de ${m.cycles.n} · ${pct(m.hitRate, 0)} (≥${pct(m.wilsonLow, 0)})` : "—"}</td>
                      <td className={cn("p-1.5", m.behavior === "Fora do padrão" ? "text-warning" : m.behavior === "Dentro do esperado" ? "text-success" : "text-muted-foreground")}>{m.behavior}</td>
                      <td className="p-1.5 font-mono text-[0.7rem]">
                        {m.history.pendentes}p · {m.history.valendo}v · <span className="text-success">{m.history.ganhas}g</span> · <span className="text-destructive">{m.history.perdidas}d</span> · {m.history.canceladas}c · {usd(m.history.lucro)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sel && (
            <div className="mt-4 grid gap-4 rounded-lg border border-border p-3 md:grid-cols-2">
              <div>
                <p className="mb-1 text-[0.75rem] text-muted-foreground">{sel.symbol} — pontuação nas últimas 24 h</p>
                <div className="h-40">
                  {selSnaps.length < 2 ? (
                    <p className="pt-10 text-center text-xs text-muted-foreground">Ainda poucos ciclos registrados.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={selSnaps}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis dataKey="hora" tick={{ fontSize: 10 }} minTickGap={24} />
                        <YAxis domain={[0, 100]} width={28} tick={{ fontSize: 10 }} />
                        <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", fontSize: 11 }} />
                        <Line type="monotone" dataKey="score" stroke="var(--color-gold)" dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
              <div>
                <p className="mb-1 text-[0.75rem] text-muted-foreground">Índice por hora</p>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={(sel.report?.indicesHora ?? []).map((h) => ({ hora: new Date(h.hourStart).getHours() + "h", indice: h.index }))}>
                      <XAxis dataKey="hora" tick={{ fontSize: 10 }} minTickGap={12} />
                      <YAxis width={28} tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", fontSize: 11 }} />
                      <Bar dataKey="indice" fill="var(--color-primary)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="apostas">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {(["todas", "ativas", "ganhas", "perdidas", "canceladas"] as const).map((f) => (
              <Button key={f} type="button" variant={filter === f ? "secondary" : "outline"} size="sm" className="h-7 px-2 text-[0.7rem]" onClick={() => setFilter(f)}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </Button>
            ))}
            <span className="mx-1 text-muted-foreground">|</span>
            {[1, 2, 3, 4, 5].map((s) => (
              <Button key={s} type="button" variant={starFilter === s ? "secondary" : "outline"} size="sm" className="h-7 px-2 text-[0.7rem]" onClick={() => setStarFilter(starFilter === s ? null : s)}>{s}★</Button>
            ))}
            <Select value={order} onValueChange={(value) => setOrder(value as typeof order)}>
              <SelectTrigger className="ml-auto h-7 w-40 text-[0.7rem]" aria-label="Ordenar apostas">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recentes">Mais recentes</SelectItem>
                <SelectItem value="progresso">Maior progresso</SelectItem>
                <SelectItem value="resultado">Maior resultado</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[0.7rem]" onClick={exportApostas}><Download />Exportar CSV</Button>
          </div>
          {bets.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Ainda não há apostas Supremo.</p>
          ) : apostas.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma aposta neste filtro.</p>
          ) : (
            <div className="grid max-h-[32rem] gap-2 overflow-y-auto sm:grid-cols-2">
              {apostas.slice(0, 100).map((r) => {
                const b = r.bet;
                const tone = b.status === "win" ? "border-success/50" : b.status === "loss" ? "border-destructive/50" : b.status === "open" ? "border-primary/50" : "border-border";
                return (
                  <div key={b.id} className={cn("rounded-lg border p-2.5 text-[0.72rem] transition-colors", tone, betFlash === b.id && "bg-gold/20")}>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{b.symbol}</span>
                      <Stars n={r.stars} size={11} />
                    </div>
                    <div className="mb-1 flex justify-between text-muted-foreground">
                      <span>Limite {formatPrice(b.stop, "")}</span>
                      <span>Alvo {formatPrice(b.target, "")}</span>
                    </div>
                    <ProgressBar row={r} />
                    <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-muted-foreground">
                      <span className="capitalize">{r.status}</span>
                      {r.progress && b.status === "open" && <span>{pct(r.progress.pos, 0)} · faltam {pct(r.progress.toTarget, 2)} p/ alvo · {pct(r.progress.toStop, 2)} p/ limite</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap justify-between gap-x-3 text-muted-foreground">
                      <span>criada há {dur(r.sinceCreate)} · armou {dur(r.toArm)} · resolveu {dur(r.toResolve)}</span>
                      <span className={cn("font-mono", (r.netPct ?? 0) > 0 ? "text-success" : (r.netPct ?? 0) < 0 ? "text-destructive" : "")}>{pct(r.netPct, 2)} · {usd(r.netUsdt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="placar">
          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ["Taxa de acerto", pct(resumo.taxa, 0)],
              ["Lucro líquido", usd(resumo.lucro)],
              ["Sequência", resumo.sequencia ? `${resumo.sequencia.n} ${resumo.sequencia.tipo === "vitorias" ? "vitória(s)" : "derrota(s)"}` : "—"],
              ["Estrelinhas conquistadas", String(resumo.estrelinhas)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-border p-2.5">
                <p className="text-[0.68rem] text-muted-foreground">{k}</p>
                <p className="font-mono text-base text-foreground">{v}</p>
              </div>
            ))}
          </div>
          <p className="mb-2 text-[0.72rem] text-muted-foreground">
            {resumo.total} apostas · {resumo.ativas} ativas
            {resumo.melhor && ` · melhor ${resumo.melhor.symbol} (${usd(resumo.melhor.lucro)})`}
            {resumo.pior && ` · pior ${resumo.pior.symbol} (${usd(resumo.pior.lucro)})`}
            {resumo.excluidas > 0 && ` · ${resumo.excluidas} fora do total (sem cotação)`}
          </p>
          <div className="mb-3 rounded-lg border border-border p-2.5 text-[0.72rem]">
            <p className={cn("font-medium", valid.metaAtingida ? "text-success" : "text-foreground")}>
              Meta: acerto ≥ {pct(breakEven, 0)} (ponto de equilíbrio da combinação) com pelo menos {META_SAMPLE} resolvidas {valid.metaAtingida ? "— atingida" : ""}
            </p>
            <div className="mt-1 h-2 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{ width: `${valid.progresso * 100}%` }} /></div>
            <p className="mt-1 text-muted-foreground">{valid.resolvidas} de {META_SAMPLE} resolvidas</p>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              <div>
                <p className="text-muted-foreground">Por regime (na criação)</p>
                {valid.porRegime.map((g) => (
                  <p key={g.key} className="font-mono">{g.key}: {pct(g.taxa, 0)} · {g.ganhas}/{g.ganhas + g.perdidas} · {usd(g.lucro)}</p>
                ))}
              </div>
              <div>
                <p className="text-muted-foreground">Moedas que mais ganham</p>
                {valid.maisGanham.length === 0 ? <p>—</p> : valid.maisGanham.map((g) => <p key={g.key} className="font-mono text-success">{g.key}: {usd(g.lucro)} ({pct(g.taxa, 0)})</p>)}
              </div>
              <div>
                <p className="text-muted-foreground">Moedas que mais perdem</p>
                {valid.maisPerdem.length === 0 ? <p>—</p> : valid.maisPerdem.map((g) => <p key={g.key} className="font-mono text-destructive">{g.key}: {usd(g.lucro)} ({pct(g.taxa, 0)})</p>)}
              </div>
            </div>
          </div>
          <div className="mb-3 grid gap-2 md:grid-cols-2">
            <div className="rounded-lg border border-border p-2.5 text-[0.72rem]">
              <p className="font-medium text-foreground">Episódios independentes</p>
              <p className="text-muted-foreground">{eps.texto} (apostas criadas a menos de 10 min uma da outra contam como um episódio)</p>
              <p className="mt-1 font-mono">
                Por aposta: {pct(resumo.taxa, 0)} · por episódio: {pct(eps.taxa, 0)}
                {eps.wilson && ` (IC ${pct(eps.wilson.low, 0)}–${pct(eps.wilson.high, 0)})`}
              </p>
              <p className="font-mono text-muted-foreground">
                <span className="text-success">{eps.ganhos} ganhos</span> · <span className="text-destructive">{eps.perdidos} perdidos</span> · {eps.neutros} neutros
              </p>
            </div>
            <div className="rounded-lg border border-border p-2.5 text-[0.72rem]">
              <p className="font-medium text-foreground">Oportunidade perdida (simulação, sem aposta real)</p>
              <p className="font-mono">
                Canceladas por alta: {sombra.canceladas}; teriam dado alvo: <span className="text-success">{sombra.alvo}</span>, stop: <span className="text-destructive">{sombra.stop}</span>, expiradas: {sombra.expiradas}
              </p>
              <p className="font-mono text-muted-foreground">
                Resultado líquido hipotético: <span className={sombra.lucroUsdt >= 0 ? "text-success" : "text-destructive"}>{usd(sombra.lucroUsdt)}</span>
                {sombra.simuladas < sombra.canceladas && ` · ${sombra.canceladas - sombra.simuladas} aguardando simulação`}
              </p>
            </div>
          </div>
          <WhyNoBet />
          {leitura.texto && <p className="mb-1 text-[0.78rem] text-foreground">{leitura.texto}</p>}
          {leitura.invertido && <p className="mb-2 text-[0.78rem] text-warning">Mais estrelinhas ainda não significam mais acertos nesta amostra.</p>}
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={placar.bands.map((b) => ({ faixa: `${b.stars}★`, taxa: b.taxa != null ? Math.round(b.taxa * 100) : 0 }))}>
                <XAxis dataKey="faixa" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} width={28} tick={{ fontSize: 10 }} unit="%" />
                <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", fontSize: 11 }} />
                <ReferenceLine y={Math.round(breakEven * 100)} stroke="var(--color-warning)" strokeDasharray="4 4" label={{ value: pct(breakEven, 0), fontSize: 10, fill: "var(--color-warning)" }} />
                <Bar dataKey="taxa" fill="var(--color-gold)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-[0.72rem]">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="p-1.5">Faixa</th><th className="p-1.5">Total</th><th className="p-1.5">G / P / C</th><th className="p-1.5">Acerto (Wilson)</th>
                  <th className="p-1.5">Lucro total / médio</th><th className="p-1.5">Tempo mediano</th><th className="p-1.5">vs {pct(breakEven, 0)}</th>
                </tr>
              </thead>
              <tbody>
                {placar.bands.map((b) => (
                  <tr key={b.stars} className="border-b border-border/50">
                    <td className="p-1.5"><Stars n={b.stars} size={11} /></td>
                    <td className="p-1.5 font-mono">{b.total}</td>
                    <td className="p-1.5 font-mono"><span className="text-success">{b.ganhas}</span> / <span className="text-destructive">{b.perdidas}</span> / {b.canceladas}</td>
                    <td className="p-1.5 font-mono">{pct(b.taxa, 0)} (≥{pct(b.wilsonLow, 0)})</td>
                    <td className="p-1.5 font-mono">{usd(b.lucroTotal)} / {usd(b.lucroMedio)}</td>
                    <td className="p-1.5 font-mono">{dur(b.tempoMedianoMs)}</td>
                    <td className={cn("p-1.5", b.vsEquilibrio === "acima" ? "text-success" : b.vsEquilibrio === "abaixo" ? "text-destructive" : "text-muted-foreground")}>
                      {b.vsEquilibrio ?? "—"}{b.amostraPequena && <span className="ml-1 text-warning">· amostra pequena</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center justify-between text-[0.7rem] text-muted-foreground">
            <span>{placar.semEstrelas > 0 ? `${placar.semEstrelas} aposta(s) antigas sem estrelinhas gravadas ficam fora do placar.` : ""}</span>
            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[0.7rem]" onClick={exportPlacar}><Download />Exportar CSV</Button>
          </div>
        </TabsContent>
      </Tabs>

      <p className="mt-4 border-t border-border pt-2 text-center text-[0.7rem] text-muted-foreground">
        Estatística de comportamento passado; não garante resultado.
      </p>
    </section>
  );
}
