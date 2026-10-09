import { useEffect, useMemo, useState } from "react";
import { readAudit, type AuditCycle } from "@/lib/supremo-live";
import { whyNoBet } from "@/lib/supremo-ranking";
import { LIVE_BLOCK_LABEL } from "@/lib/supremo";

/** Painel "Por que não apostou": motivos de bloqueio nos últimos 60 ciclos. */
export function WhyNoBet() {
  const [audit, setAudit] = useState<AuditCycle[]>([]);
  useEffect(() => {
    setAudit(readAudit());
    const on = () => setAudit(readAudit());
    window.addEventListener("supremo-audit", on);
    return () => window.removeEventListener("supremo-audit", on);
  }, []);
  const rows = useMemo(() => whyNoBet(audit), [audit]);
  const max = Math.max(1, ...rows.map((r) => r.ciclos));
  const total = audit.slice(0, 60).length;
  return (
    <div className="mt-3 rounded-lg border border-border p-2.5 text-xs">
      <p className="mb-1 font-semibold text-foreground">Por que não apostou (últimos {total} ciclos)</p>
      <p className="mb-2 text-muted-foreground">Não apostar também é uma decisão.</p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">Nenhum ciclo bloqueado registrado.</p>
      ) : (
        <ul className="space-y-1">
          {rows.slice(0, 10).map((r) => (
            <li key={r.motivo} className="grid grid-cols-[10rem_1fr_2rem] items-center gap-2">
              <span className="truncate text-muted-foreground" title={r.motivo in LIVE_BLOCK_LABEL ? LIVE_BLOCK_LABEL[r.motivo as keyof typeof LIVE_BLOCK_LABEL] : r.motivo}>
                {r.motivo}
              </span>
              <span className="h-2 rounded bg-muted">
                <span className="block h-2 rounded bg-primary" style={{ width: `${(r.ciclos / max) * 100}%` }} />
              </span>
              <span className="text-right font-mono">{r.ciclos}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
