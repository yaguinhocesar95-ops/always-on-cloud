/**
 * Expiração de apostas Supremo que nunca armaram (lógica pura, testável).
 * Resultado "cancelada": sem P&L, sem taxa, libera a vaga da moeda.
 */
export const PENDING_MAX_MS = 10 * 60_000;
export const FAR_ABOVE_TRIGGER = 0.01;
export const FAR_MAX_MS = 5 * 60_000;

export type ExpiryInput = {
  status: string;
  createdAt: number;
  triggerPrice: number;
  target: number;
  farSince?: number | null | undefined;
};

export type ExpiryDecision =
  | { cancel: true; reason: string }
  | { cancel: false; farSince: number | null };

/**
 * (a) 10 min sem armar; (b) preço no alvo ou acima sem armar; (c) preço
 * mais de 1,0% acima do gatilho por 5 min seguidos.
 */
export function pendingExpiry(b: ExpiryInput, px: number | null, now: number): ExpiryDecision {
  const far0 = b.farSince ?? null;
  if (b.status !== "pending") return { cancel: false, farSince: far0 };
  if (now - b.createdAt >= PENDING_MAX_MS) return { cancel: true, reason: "10 min sem armar" };
  if (px == null || !(px > 0)) return { cancel: false, farSince: far0 };
  if (px >= b.target) return { cancel: true, reason: "preço passou do alvo sem armar" };
  const far = px > b.triggerPrice * (1 + FAR_ABOVE_TRIGGER);
  if (!far) return { cancel: false, farSince: null };
  const since = far0 ?? now;
  if (now - since >= FAR_MAX_MS) return { cancel: true, reason: "preço ficou mais de 1% acima do gatilho por 5 min" };
  return { cancel: false, farSince: since };
}
