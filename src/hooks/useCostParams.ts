/**
 * Parâmetros de custo editáveis (taxa, spread, escorregamento).
 *
 * Guardados só no navegador. Cada campo lembra se o valor veio de sugestão
 * automática ou de digitação manual — é isso que é gravado como auditoria
 * junto da aposta (`cost_source` em auto_bets).
 */

import { useCallback, useEffect, useState } from "react";

import type { CostSource } from "@/lib/cost-tiers";

export type CostField = "fee_pct" | "slippage_pct" | "spread_pct";

export type CostParams = Record<CostField, number | null>;
export type CostSources = Record<CostField, CostSource>;

const STORAGE_KEY = "ypx-cost-params-v1";

const EMPTY: CostParams = { fee_pct: null, slippage_pct: null, spread_pct: null };
const EMPTY_SOURCES: CostSources = { fee_pct: "motor", slippage_pct: "motor", spread_pct: "motor" };

export function useCostParams() {
  const [params, setParams] = useState<CostParams>(EMPTY);
  const [sources, setSources] = useState<CostSources>(EMPTY_SOURCES);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { params?: CostParams; sources?: CostSources };
      if (saved.params) setParams({ ...EMPTY, ...saved.params });
      if (saved.sources) setSources({ ...EMPTY_SOURCES, ...saved.sources });
    } catch {
      /* storage corrompido: segue com os padrões do motor */
    }
  }, []);

  const persist = useCallback((p: CostParams, s: CostSources) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ params: p, sources: s }));
    } catch {
      /* storage cheio ou indisponível */
    }
  }, []);

  /** Digitação manual em um campo. */
  const setField = useCallback(
    (field: CostField, value: number | null) => {
      setParams((prev) => {
        const next = { ...prev, [field]: value };
        setSources((prevSrc) => {
          const nextSrc = { ...prevSrc, [field]: (value == null ? "motor" : "manual") as CostSource };
          persist(next, nextSrc);
          return nextSrc;
        });
        return next;
      });
    },
    [persist],
  );

  /** Aplica sugestão automática em um ou mais campos. */
  const applySuggestion = useCallback(
    (values: Partial<Record<CostField, number>>) => {
      setParams((prev) => {
        const next = { ...prev, ...values };
        setSources((prevSrc) => {
          const nextSrc = { ...prevSrc };
          for (const k of Object.keys(values) as CostField[]) nextSrc[k] = "sugerido";
          persist(next, nextSrc);
          return nextSrc;
        });
        return next;
      });
    },
    [persist],
  );

  const reset = useCallback(() => {
    setParams(EMPTY);
    setSources(EMPTY_SOURCES);
    persist(EMPTY, EMPTY_SOURCES);
  }, [persist]);

  /** Origem consolidada: sugerido só quando nenhum campo foi editado à mão. */
  const costSource: CostSource = (["fee_pct", "slippage_pct", "spread_pct"] as CostField[]).some(
    (f) => sources[f] === "manual",
  )
    ? "manual"
    : (["fee_pct", "slippage_pct", "spread_pct"] as CostField[]).some(
          (f) => sources[f] === "sugerido",
        )
      ? "sugerido"
      : "motor";

  return { params, sources, costSource, setField, applySuggestion, reset };
}
