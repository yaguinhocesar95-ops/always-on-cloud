import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Bet } from "@/hooks/useBets";
import { mergeBets } from "@/lib/bet-engine";
import { ALL_SYNC_KEYS, AUDIT_KEY, BET_KEYS, DAILY_RESET_KEYS, RESET_DAY_KEY, TOMBSTONE_KEY, emitCloudPull, saoPauloDay } from "@/lib/cloud-keys";

const META_KEY = "ypx-sync-meta";
const EVERY_MS = 15_000;

const readMeta = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(META_KEY) ?? "{}"); } catch { return {}; }
};
const parse = (s: string | null): unknown => {
  try { return s == null ? null : JSON.parse(s); } catch { return null; }
};

let syncing = false;

/** Mantém os dados do navegador e da nuvem iguais enquanto houver login. */
async function syncOnce(userId: string) {
  if (syncing) return;
  syncing = true;
  try {
    const { data, error } = await supabase.from("user_kv").select("key, value").eq("user_id", userId);
    if (error) return;
    const server = new Map((data ?? []).map((r) => [r.key, r.value as unknown]));
    // Reset diário à meia-noite: zera apostas e auditoria (banca e ajustes ficam).
    const today = saoPauloDay();
    if (localStorage.getItem(RESET_DAY_KEY) !== JSON.stringify(today)) {
      for (const k of DAILY_RESET_KEYS) { localStorage.setItem(k, "[]"); emitCloudPull(k); }
      localStorage.setItem(RESET_DAY_KEY, JSON.stringify(today));
    }
    if (server.get(RESET_DAY_KEY) !== today) {
      for (const k of DAILY_RESET_KEYS) server.set(k, []);
    }
    const meta = readMeta();
    const tomb = new Set<string>([
      ...((parse(localStorage.getItem(TOMBSTONE_KEY)) as string[] | null) ?? []),
      ...((server.get(TOMBSTONE_KEY) as string[] | undefined) ?? []),
    ]);
    const upserts: { user_id: string; key: string; value: never; updated_at: string }[] = [];
    for (const key of ALL_SYNC_KEYS) {
      const localRaw = localStorage.getItem(key);
      const local = parse(localRaw);
      const remote = server.has(key) ? server.get(key) : null;
      let merged: unknown;
      if ((BET_KEYS as readonly string[]).includes(key)) {
        merged = mergeBets((local as Bet[]) ?? [], (remote as Bet[]) ?? [], tomb);
      } else if (key === TOMBSTONE_KEY) {
        merged = [...tomb].slice(-5000);
      } else if (key === AUDIT_KEY) {
        const m = new Map<string, { id: string; at: number }>();
        for (const a of [...((local as never[]) ?? []), ...((remote as never[]) ?? [])] as { id: string; at: number }[]) m.set(a.id, a);
        merged = [...m.values()].sort((a, b) => b.at - a.at).slice(0, 60);
      } else {
        // Três vias: quem mudou desde a última sincronização vence.
        const last = meta[key];
        const localChanged = localRaw != null && localRaw !== last;
        merged = localChanged || remote == null ? local : remote;
      }
      if (merged == null) continue;
      const json = JSON.stringify(merged);
      if (json !== localRaw) {
        localStorage.setItem(key, json);
        emitCloudPull(key);
      }
      if (json !== JSON.stringify(remote)) upserts.push({ user_id: userId, key, value: merged as never, updated_at: new Date().toISOString() });
      meta[key] = json;
    }
    if (upserts.length) await supabase.from("user_kv").upsert(upserts);
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } finally {
    syncing = false;
  }
}

export function CloudSync() {
  useEffect(() => {
    let userId: string | null = null;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = (uid: string | null) => {
      userId = uid;
      if (id) clearInterval(id);
      id = null;
      if (!uid) return;
      void syncOnce(uid);
      id = setInterval(() => userId && void syncOnce(userId), EVERY_MS);
    };
    void supabase.auth.getSession().then(({ data }) => start(data.session?.user.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") start(session?.user.id ?? null);
    });
    return () => {
      sub.subscription.unsubscribe();
      if (id) clearInterval(id);
    };
  }, []);
  return null;
}
