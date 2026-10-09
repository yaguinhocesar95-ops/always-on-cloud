import { createFileRoute } from "@tanstack/react-router";

/** Prova do Passo 1: últimas 5 velas de BTC e SOL pela fonte do servidor. Exige o token da rodada. */
export const Route = createFileRoute("/api/public/cron/candles-test")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const given = new URL(request.url).searchParams.get("token") ?? request.headers.get("x-cron-token") ?? "";
        const { data } = await supabaseAdmin.from("cron_config").select("token").eq("id", 1).maybeSingle();
        if (!data?.token || given !== data.token) return new Response("Unauthorized", { status: 401 });
        const { serverCandles, bybitCandles } = await import("@/lib/server-prices");
        const out: Record<string, unknown> = {};
        for (const s of ["BTCUSDT", "SOLUSDT"]) {
          try {
            const r = await serverCandles(s, 5);
            out[s] = { source: r.candles[0]?.source, fallbackReason: r.fallbackReason, candles: r.candles };
          } catch (e) {
            out[s] = { error: (e as Error).message };
          }
          try {
            out[`${s}_bybit`] = { candles: (await bybitCandles(s, 2)).length };
          } catch (e) {
            out[`${s}_bybit`] = { error: (e as Error).message };
          }
        }
        return Response.json(out);
      },
    },
  },
});
