import { createFileRoute } from "@tanstack/react-router";

/** Prova do Passo 1: mesma conferência de preços da rodada automática, sem rodar apostas. Exige o token. */
export const Route = createFileRoute("/api/public/cron/candles-test")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const given = request.headers.get("x-cron-token") ?? "";
        const { data } = await supabaseAdmin.from("cron_config").select("token").eq("id", 1).maybeSingle();
        if (!data?.token || given !== data.token) return new Response("Unauthorized", { status: 401 });
        const { runPriceProbe } = await import("@/lib/price-probe.server");
        return Response.json(await runPriceProbe());
      },
    },
  },
});
