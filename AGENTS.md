<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep Supremo performance calculations in `src/lib/supremo-ranking.ts` and render them through the shared `SupremoRanking` component so both live pages stay consistent.
- Load numeric fonts locally and apply them through the shared mono token and numeric utilities, so values stay consistent and legible across pages without changing text typography.
- Bet rules (create/advance/merge) live in `src/lib/bet-engine.ts` and the Supremo cycle in `src/lib/supremo-cycle.ts`, so the browser hook and the server cron share one implementation.
- Signed-in users mirror the localStorage keys listed in `src/lib/cloud-keys.ts` to the `user_kv` table via `CloudSync`; bet lists merge by id with tombstones, so browser and server writes never clobber each other.
- The per-minute cron calls `/api/public/cron/supremo`, authenticated by a token stored in `cron_config` (service-role only), and runs Supremo with an in-memory localStorage shim, so lib code stays storage-agnostic.
- Every Binance fetch and each Supremo cycle has a time limit, and locks expire, so a hung request never stops the automatic runs.
- The server picks its Binance host at the start of each cloud run from `SERVER_HOSTS` in `src/lib/binance.ts` (first one that answers), because Binance blocks some hosts from cloud IPs; the cloud writes a heartbeat key and the browser takes over every minute when that heartbeat is stale, never using the audit log as the liveness signal (browser cycles also write to it).
