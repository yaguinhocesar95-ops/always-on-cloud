/**
 * Patch — validação de schema ANTES de gravar em auto_bets.
 *
 * O motor pode, em teoria, produzir um número corrompido (feed sujo, divisão
 * por zero, campo nulo). Em vez de confiar, o payload passa por um schema
 * explícito com tipos e faixas plausíveis. O que não passa é REJEITADO e
 * registrado — nunca gravado.
 */

import { z } from "zod";

const finitePositive = z.number().finite().positive();

/** Distâncias esperadas do modelo: gatilho→alvo e gatilho→stop ≈ 0,55%. */
export const MIN_LEG_PCT = 0.001; // 0,10%
export const MAX_LEG_PCT = 0.05; // 5%
/** O preço de mercado no instante do sinal não pode divergir absurdamente. */
export const MAX_PRICE_DIVERGENCE_PCT = 0.5; // 50%

export const autoBetSchema = z
  .object({
    symbol: z
      .string()
      .min(4)
      .max(20)
      .regex(/^[A-Z0-9]+$/),
    quote: z.string().min(2).max(10),
    trigger_price: finitePositive,
    target: finitePositive,
    stop: finitePositive,
    price_at_create: finitePositive,
    status: z.literal("pending"),
    hour_local: z.number().int().min(0).max(23),
    engine_version: z.string().min(1).max(64),
    round_key: z.string().min(3).max(64),
    regime: z.enum(["calmo", "normal", "agitado"]),
    spread_pct: z.number().finite().min(0).max(0.1).nullable(),
    slippage_pct: z.number().finite().min(0).max(0.1),
    slippage_source: z.string().min(1).max(32),
    fee_pct: z.number().finite().min(0).max(0.05),
    latency_ms: z.number().int().min(0).max(60_000),
    tick_size: z.number().finite().positive().nullable(),
    tick_estimated: z.boolean(),
    entry_fill: finitePositive,
    target_fill: finitePositive,
    stop_fill: finitePositive,
    net_if_win: z.number().finite().min(-1).max(1),
    net_if_loss: z.number().finite().min(-1).max(1),
    is_validation_probe: z.boolean(),
    // Auditoria: de onde vieram os parâmetros de custo desta aposta.
    cost_source: z.enum(["motor", "sugerido", "manual"]).default("motor"),
    cost_tier: z.enum(["A", "B", "C"]).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    const add = (message: string) => ctx.addIssue({ code: "custom", message });

    if (!(v.target > v.trigger_price)) add("alvo precisa estar acima do gatilho");
    if (!(v.stop < v.trigger_price)) add("stop precisa estar abaixo do gatilho");

    const up = (v.target - v.trigger_price) / v.trigger_price;
    const down = (v.trigger_price - v.stop) / v.trigger_price;
    if (up < MIN_LEG_PCT || up > MAX_LEG_PCT) add(`distância até o alvo fora da faixa (${up})`);
    if (down < MIN_LEG_PCT || down > MAX_LEG_PCT)
      add(`distância até o stop fora da faixa (${down})`);

    const diverge = Math.abs(v.price_at_create - v.trigger_price) / v.trigger_price;
    if (diverge > MAX_PRICE_DIVERGENCE_PCT) add("preço de mercado divergente do gatilho");

    if (v.net_if_loss >= 0) add("perda líquida precisa ser negativa");
  });

export type AutoBetPayload = z.infer<typeof autoBetSchema>;

export type BetValidation = { ok: true; value: AutoBetPayload } | { ok: false; reason: string };

/** Valida o payload calculado. Erro vira motivo legível, nunca gravação. */
export function validateAutoBet(payload: unknown): BetValidation {
  const parsed = autoBetSchema.safeParse(payload);
  if (parsed.success) return { ok: true, value: parsed.data };
  const reason = parsed.error.issues
    .slice(0, 4)
    .map((i) => `${i.path.join(".") || "payload"}: ${i.message}`)
    .join("; ");
  return { ok: false, reason: reason.slice(0, 200) };
}
