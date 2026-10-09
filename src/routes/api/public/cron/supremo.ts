import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

export const Route = createFileRoute("/api/public/cron/supremo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const given = request.headers.get("x-cron-token") ?? "";
        const { data } = await supabaseAdmin.from("cron_config").select("token").eq("id", 1).maybeSingle();
        const expected = data?.token ?? "";
        const a = Buffer.from(given);
        const b = Buffer.from(expected);
        if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { runPriceProbe } = await import("@/lib/price-probe.server");
        const { runCloudCycle } = await import("@/lib/cloud-run.server");
        const probe = await runPriceProbe();
        let cycle: unknown = null;
        let error: string | null = null;
        try {
          cycle = await runCloudCycle(supabaseAdmin);
        } catch (e) {
          error = (e as Error).message;
          console.error("cron supremo", e);
        }
        const ok = probe.responded > 0 && !error;
        await supabaseAdmin.from("cron_runs").insert({
          ok, responded: probe.responded, total: probe.total, sources: probe.sources as string[],
          probe: probe as never, cycle: cycle as never, error,
        });
        return Response.json({ ok, probe, cycle, error }, { status: ok ? 200 : 502 });
      },
    },
  },
});
