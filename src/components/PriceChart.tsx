import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ChartPoint = { time: number; price: number };

type Props = {
  data: ChartPoint[];
  entryPrice: number | null;
  fmtPrice: (v: number | null) => string;
};

export function PriceChart({ data, entryPrice, fmtPrice }: Props) {
  const prices = data.map((d) => d.price);
  const lo = Math.min(...prices, entryPrice ?? Infinity);
  const hi = Math.max(...prices, entryPrice ?? -Infinity);
  const pad = isFinite(hi - lo) ? (hi - lo) * 0.08 || hi * 0.001 : 1;

  return (
    <section className="tv-panel p-4">
      <div className="relative z-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="tv-headline text-[0.95rem] text-foreground">Janela viva · 180 segundos</h2>
          <span className="font-mono text-[0.6rem] tracking-[0.16em] text-muted-foreground uppercase">
            {data.length} ticks
          </span>
        </div>
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 56, bottom: 8, left: 8 }}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="time"
                tickFormatter={(t: number) =>
                  new Date(t).toLocaleTimeString("pt-BR", {
                    minute: "2-digit",
                    second: "2-digit",
                  })
                }
                stroke="var(--color-muted-foreground)"
                tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                minTickGap={40}
              />
              <YAxis
                domain={[lo - pad, hi + pad]}
                stroke="var(--color-muted-foreground)"
                tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                width={90}
                tickFormatter={(v: number) => fmtPrice(v)}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--color-popover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 6,
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                }}
                labelFormatter={(t) => new Date(Number(t)).toLocaleTimeString("pt-BR")}
                formatter={(v: number) => [fmtPrice(v), "Preço"]}
              />
              {entryPrice != null && (
                <ReferenceLine
                  y={entryPrice}
                  stroke="var(--color-success)"
                  strokeDasharray="6 4"
                  label={{
                    value: "GATILHO",
                    position: "right",
                    fill: "var(--color-success)",
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                  }}
                />
              )}
              <Line
                type="monotone"
                dataKey="price"
                stroke="var(--color-chart-1)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
