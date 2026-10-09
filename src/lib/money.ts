export type DisplayCurrency = "BRL" | "USDT";

/** Converte um valor de uma cotação (BRL/USDT) para a moeda de exibição. */
export function convertMoney(
  value: number,
  from: string,
  to: DisplayCurrency,
  usdtBrl: number | null,
): number | null {
  if (!isFinite(value)) return null;
  const src = from === "BRL" ? "BRL" : "USDT";
  if (src === to) return value;
  if (!usdtBrl || !isFinite(usdtBrl) || usdtBrl <= 0) return null;
  return src === "USDT" ? value * usdtBrl : value / usdtBrl;
}

export function currencySymbol(currency: DisplayCurrency): string {
  return currency === "BRL" ? "R$" : "US$";
}

/** Formata um valor monetário (saldo, ganho, aposta) na moeda escolhida. */
export function formatMoney(
  value: number | null,
  currency: DisplayCurrency,
  opts: { signed?: boolean } = {},
): string {
  if (value == null || !isFinite(value)) return "—";
  const n = Math.abs(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = opts.signed ? (value >= 0 ? "+" : "−") : value < 0 ? "−" : "";
  return `${sign}${currencySymbol(currency)} ${n}`;
}

/** Formata preços de mercado, com mais casas decimais para moedas baratas. */
export function formatQuotePrice(value: number | null, currency: DisplayCurrency): string {
  if (value == null || !isFinite(value)) return "—";
  const digits = value >= 1000 ? 2 : value >= 1 ? 4 : 6;
  const n = value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${currencySymbol(currency)} ${n}`;
}
