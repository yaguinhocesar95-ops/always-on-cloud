import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { LIVE_BLOCK_LABEL } from "@/lib/supremo";
import type { Bankroll } from "@/hooks/useBankroll";
import type { Bet } from "@/hooks/useBets";
import { readActiveCombo } from "@/lib/supremo-combo";
import { comboLabel } from "@/lib/target-stop-lab";
import { appendAudit, exposureBlock, newId, readExposure } from "@/lib/supremo-live";
import type { ScoredRow } from "@/hooks/supremoScoring";
import type { RegimeReading } from "@/lib/market-regime";
import { betOptsFromRow, runSupremoCycle } from "@/lib/supremo-cycle";
import { CLOUD_BEAT_KEY } from "@/lib/cloud-keys";

export { protectionBlocks } from "@/lib/supremo-cycle";

type PlaceBet = (b: any) => void;

export const SUPREMO_INTERVAL_MS = 60_000;

/** Trava global: só UMA geração Supremo roda por vez na aba. */
let inFlight = false;
let inFlightSince = 0;
/** Tempo máximo de um ciclo; passou disso, a trava é liberada e o próximo ciclo roda. */
export const CYCLE_TIMEOUT_MS = 55_000;
export function __resetSupremoLock() {
  inFlight = false;
  inFlightSince = 0;
}
/** Se a nuvem não dá sinal de vida há este tempo, o navegador assume a geração a cada minuto. */
export const SERVER_STALE_MS = 2.5 * 60_000;
/**
 * Último sinal de vida da nuvem (gravado só pelo servidor). Não usa a auditoria,
 * porque os ciclos do próprio navegador também entram nela e mascaravam a falha.
 */
export function lastCloudBeat(): number {
  try {
    const v = Number(JSON.parse(localStorage.getItem(CLOUD_BEAT_KEY) ?? "0"));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}
export function isCloudStale(now: number, beat: number = lastCloudBeat()): boolean {
  return now - beat > SERVER_STALE_MS;
}
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("ciclo demorou demais; tentando de novo no próximo minuto")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Agenda um único intervalo; devolve a função de cancelamento. Exportado para teste. */
export function startSupremoTimer(
  onTick: (now: number) => void,
  onDue: () => void,
  intervalMs = SUPREMO_INTERVAL_MS,
  clock: () => number = Date.now,
) {
  let next = clock() + intervalMs;
  const id = setInterval(() => {
    const n = clock();
    onTick(n);
    if (n >= next) {
      next = n + intervalMs;
      onDue();
    }
  }, 1000);
  return { next: () => next, stop: () => clearInterval(id) };
}

/**
 * Geração automática de apostas Supremo (a cada 1 min).
 * `serverRuns`: a rodada acontece no servidor; aqui só atualizamos o painel.
 */
export function useSupremoAuto(opts: {
  enabled: boolean;
  serverRuns?: boolean;
  placeBet: PlaceBet;
  bets: Bet[];
  bankroll: Bankroll;
  usdtBrl: number | null;
  livePrices?: Map<string, number> | undefined;
}) {
  const [cloudDown, setCloudDown] = useState(false);
  const [nextAt, setNextAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [reason, setReason] = useState<string | null>(null);
  const [scored, setScored] = useState<ScoredRow[]>([]);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [nextPick, setNextPick] = useState<string | null>(null);
  const [regime, setRegime] = useState<RegimeReading | null>(null);
  const regimeRef = useRef<RegimeReading | null>(null);
  const ctx = useRef(opts);
  ctx.current = opts;

  const placeRow = (row: ScoredRow, quote: string): boolean => {
    const b = betOptsFromRow(row, quote, ctx.current.bankroll, ctx.current.usdtBrl, regimeRef.current?.regime);
    if (!b) return false;
    ctx.current.placeBet({
      ...b,
      guard: (current: Bet[]) => exposureBlock(current, b.symbol, b.combo, readExposure(), Date.now()),
      onBlocked: (why: string) => setReason(`Aposta não registrada: ${why}.`),
    });
    return true;
  };

  const betOn = (symbol: string) => {
    const row = scored.find((r) => r.symbol === symbol);
    if (!row) return;
    if (!(ctx.current.bankroll.stake > 0)) return void toast.error("Informe o valor por aposta em “Sua banca”.");
    if (row.blocks.length > 0) return void toast.error(`${symbol} está bloqueada: ${row.blocks.map((b) => LIVE_BLOCK_LABEL[b]).join(", ")}.`);
    const combo = readActiveCombo();
    const exp = exposureBlock(ctx.current.bets, symbol, comboLabel(combo.targetPct, combo.stopPct, combo.mode), readExposure(), Date.now());
    if (exp) return void toast.error(`Aposta não registrada: ${exp}.`);
    appendAudit({ id: newId(), at: Date.now(), chosen: symbol, note: "Manual: Apostar nesta", coins: [] });
    if (placeRow(row, row.quote)) toast.success(`Aposta Supremo registrada em ${symbol}.`);
  };

  const generate = async (place = true) => {
    const { bankroll, livePrices, bets, usdtBrl } = ctx.current;
    if (place && !(bankroll.stake > 0)) return;
    if (inFlight && Date.now() - inFlightSince < CYCLE_TIMEOUT_MS + 5_000) return;
    inFlight = true;
    inFlightSince = Date.now();
    try {
      const r = await withTimeout(runSupremoCycle({ bets, bankroll, usdtBrl, livePrices, place }), CYCLE_TIMEOUT_MS);
      regimeRef.current = r.regime;
      setRegime(r.regime);
      setScored(r.scored);
      setScannedAt(Date.now());
      setNextPick(r.nextPick);
      if (!place) return;
      if (r.note) return void setReason(r.note);
      if (r.chosenRow) {
        placeRow(r.chosenRow, r.bet?.quote ?? "USDT");
        setReason(null);
        toast.success(`Aposta Supremo registrada em ${r.chosenRow.symbol} (${r.chosenRow.stars ?? "—"} estrelinha(s), índice ${r.chosenRow.analysis.index}).`);
      }
    } catch (e) {
      setReason(`Falha ao gerar: ${(e as Error).message}`);
    } finally {
      inFlight = false;
      inFlightSince = 0;
    }
  };
  const genRef = useRef(generate);
  genRef.current = generate;

  useEffect(() => {
    void genRef.current(false);
  }, []);

  useEffect(() => {
    if (!opts.enabled) {
      setNextAt(null);
      return;
    }
    if (opts.serverRuns) {
      // O servidor roda a cada minuto cheio; aqui só contamos e atualizamos o painel.
      const nextMinute = () => Math.ceil((Date.now() + 1) / 60_000) * 60_000;
      let due = nextMinute();
      setNextAt(due);
      const id = setInterval(() => {
        const n = Date.now();
        setNow(n);
        if (n >= due + 5_000) {
          due = nextMinute();
          // Rede de segurança: se a nuvem parou de dar sinal de vida, o navegador gera a aposta todo minuto.
          const stale = isCloudStale(n);
          setCloudDown(stale);
          void genRef.current(stale);
        }
        setNextAt(due);
      }, 1000);
      return () => {
        clearInterval(id);
        setCloudDown(false);
      };
    }
    const timer = startSupremoTimer(
      (n) => {
        setNow(n);
        setNextAt(timer.next());
      },
      () => void genRef.current(),
    );
    setNextAt(timer.next());
    return () => timer.stop();
  }, [opts.enabled, opts.serverRuns]);

  const countdown =
    nextAt == null
      ? null
      : (() => {
          const s = Math.max(0, Math.ceil((nextAt - now) / 1000));
          return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
        })();

  return {
    countdown,
    reason,
    scored,
    scannedAt,
    nextPick,
    betOn,
    refresh: () => void genRef.current(false),
    generateNow: () => void genRef.current(),
    labels: LIVE_BLOCK_LABEL,
    regime,
    /** A nuvem não está rodando: as apostas só continuam com a página aberta. */
    cloudDown,
  };
}
