import { useCallback, useEffect, useState } from "react";
import type { DisplayCurrency } from "@/lib/money";
import { CLOUD_PULL_EVENT } from "@/lib/cloud-keys";

const STORAGE_KEY = "scalp-terminal-bankroll-v2";

export const DEFAULT_LEVERAGE = 5;

export type Bankroll = {
  /** Valor declarado que o usuário tem disponível para começar. */
  initial: number;
  /** Valor aplicado em cada nova aposta (margem, antes da alavancagem). */
  stake: number;
  leverage: number;
  /** Moeda em que o usuário declara e vê os valores. */
  currency: DisplayCurrency;
  /** Quando ligado, o valor por aposta é travado em initial × leverage. */
  leveraged: boolean;
};

const EMPTY: Bankroll = {
  initial: 0,
  stake: 0,
  leverage: DEFAULT_LEVERAGE,
  currency: "BRL",
  leveraged: false,
};

export function useBankroll() {
  const [bankroll, setBankroll] = useState<Bankroll>(EMPTY);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const load = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Bankroll>;
        setBankroll({
          initial: Number(parsed.initial) || 0,
          stake: Number(parsed.stake) || 0,
          leverage: Number(parsed.leverage) || DEFAULT_LEVERAGE,
          currency: parsed.currency === "USDT" ? "USDT" : "BRL",
          leveraged: Boolean(parsed.leveraged),
        });
      }
    } catch {
      /* armazenamento corrompido */
    }
    };
    load();
    setHydrated(true);
    const onPull = (e: Event) => { if ((e as CustomEvent<string>).detail === STORAGE_KEY) load(); };
    window.addEventListener(CLOUD_PULL_EVENT, onPull);
    return () => window.removeEventListener(CLOUD_PULL_EVENT, onPull);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bankroll));
    } catch {
      /* armazenamento indisponível */
    }
  }, [bankroll, hydrated]);

  const setInitial = useCallback((initial: number) => {
    setBankroll((prev) => ({
      ...prev,
      initial,
      // Alavancado: aposta travada em initial × leverage.
      // Caso contrário, se ainda não foi definida, ela acompanha o valor inicial.
      stake: prev.leveraged ? initial * prev.leverage : prev.stake > 0 ? prev.stake : initial,
    }));
  }, []);

  const setLeveraged = useCallback((leveraged: boolean) => {
    setBankroll((prev) => ({
      ...prev,
      leveraged,
      stake: leveraged ? prev.initial * prev.leverage : prev.stake,
    }));
  }, []);

  const setStake = useCallback((stake: number) => setBankroll((prev) => ({ ...prev, stake })), []);

  const setLeverage = useCallback(
    (leverage: number) => setBankroll((prev) => ({ ...prev, leverage })),
    [],
  );

  const setCurrency = useCallback(
    (currency: DisplayCurrency) => setBankroll((prev) => ({ ...prev, currency })),
    [],
  );

  return {
    bankroll,
    hydrated,
    setInitial,
    setStake,
    setLeverage,
    setCurrency,
    setLeveraged,
  };
}
