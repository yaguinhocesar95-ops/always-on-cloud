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
        const { runCloudCycle } = await import("@/lib/cloud-run.server");
        try {
          const out = await runCloudCycle(supabaseAdmin);
          return Response.json(out);
        } catch (e) {
          console.error("cron supremo", e);
          return Response.json({ error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
