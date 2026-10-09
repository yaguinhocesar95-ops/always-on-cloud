import { useEffect, useState, type ReactNode } from "react";

const TAB_KEY = "ypx-active-tab";
const CHANNEL = "ypx-single-tab";

/**
 * Garante uma única sessão ativa por navegador: a aba aberta por último
 * assume e as outras pausam (desmontam o app), para não gravarem apostas
 * por cima da aba ativa. Navegadores diferentes não se bloqueiam.
 */
export function SingleSessionGuard({ children }: { children: ReactNode }) {
  const [blocked, setBlocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [tabId] = useState(() => (typeof crypto !== "undefined" ? crypto.randomUUID() : "ssr"));

  useEffect(() => {
    const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;
    const claim = () => {
      localStorage.setItem(TAB_KEY, tabId);
      bc?.postMessage(tabId);
    };
    // Recomeço: apaga registros de sessões anteriores (aparelho e aba antigos).
    for (const k of ["ypx-device-id"]) localStorage.removeItem(k);
    claim();
    setReady(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === TAB_KEY && e.newValue && e.newValue !== tabId) setBlocked(true);
    };
    const onMsg = (e: MessageEvent) => {
      if (e.data !== tabId) setBlocked(true);
    };
    const tick = setInterval(() => {
      if (localStorage.getItem(TAB_KEY) !== tabId) setBlocked(true);
    }, 2000);
    window.addEventListener("storage", onStorage);
    bc?.addEventListener("message", onMsg);
    return () => {
      clearInterval(tick);
      window.removeEventListener("storage", onStorage);
      bc?.close();
    };
  }, [tabId]);

  if (!ready) return null;
  if (!blocked) return <>{children}</>;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/95 px-4 backdrop-blur">
      <div className="max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-lg">
        <h2 className="text-xl font-semibold text-foreground">Projeto aberto em outra aba</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Só uma aba pode ficar ativa neste navegador. Esta foi pausada para que as apostas não se percam nem sejam duplicadas.
        </p>
        <button
          onClick={() => {
            localStorage.setItem(TAB_KEY, tabId);
            window.location.reload();
          }}
          className="mt-5 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Usar aqui
        </button>
      </div>
    </div>
  );
}
