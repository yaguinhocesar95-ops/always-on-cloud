/**
 * Patch — grupos de pares correlacionados.
 *
 * Abrir repique em BTCBRL, ETHBRL e SOLBRL ao mesmo tempo não é diversificar:
 * é a MESMA aposta direcional em três lugares. BTCUSDT fica em outro grupo
 * porque tem moeda de cotação distinta (não carrega o risco BRL) e é
 * tratado separadamente.
 *
 * Esta regra só BLOQUEIA — nunca cria sinal.
 */

export const CORRELATION_GROUPS: Record<string, readonly string[]> = {
  "cripto-brl": ["BTCBRL", "ETHBRL", "SOLBRL"],
  "cripto-usdt": ["BTCUSDT"],
};

/** Janela em que duas aberturas contam como exposição simultânea. */
export const CORRELATION_WINDOW_MS = 10 * 60 * 1000;

export function correlationGroupOf(symbol: string): string | null {
  for (const [group, members] of Object.entries(CORRELATION_GROUPS)) {
    if (members.includes(symbol)) return group;
  }
  return null;
}

/** Outros pares do mesmo grupo (o próprio símbolo fica de fora). */
export function correlatedPeers(symbol: string): string[] {
  const group = correlationGroupOf(symbol);
  if (!group) return [];
  return CORRELATION_GROUPS[group]!.filter((s) => s !== symbol);
}

export type OpenExposure = { symbol: string; status: string; createdAt: number };

/**
 * Pares correlacionados com aposta aberta/pendente na mesma janela de tempo.
 * Lista vazia = nada a bloquear.
 */
export function correlatedOpenSymbols(
  symbol: string,
  exposures: readonly OpenExposure[],
  now: number,
  windowMs: number = CORRELATION_WINDOW_MS,
): string[] {
  const peers = new Set(correlatedPeers(symbol));
  if (peers.size === 0) return [];
  const out = new Set<string>();
  for (const e of exposures) {
    if (!peers.has(e.symbol)) continue;
    if (e.status !== "pending" && e.status !== "open") continue;
    if (now - e.createdAt > windowMs) continue;
    out.add(e.symbol);
  }
  return [...out].sort();
}

export const CORRELATION_BLOCK_REASON =
  "sinal correlacionado — evitando duplicidade de exposição direcional";
