import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, Cloud, CloudOff, Crown, Focus, History, LayoutDashboard, Ticket } from "lucide-react";
import { useCloudUser } from "@/hooks/useCloudUser";
import { SettingsMenu } from "@/components/SettingsMenu";
import { DisclaimerFooter } from "@/components/DisclaimerFooter";
import { useShellStatus, type ShellStatus } from "@/hooks/useShellStatus";
import { useUiLayout } from "@/hooks/useUiLayout";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/", label: "Terminal", icon: LayoutDashboard },
  { to: "/supremo", label: "Supremo", icon: Crown },
  { to: "/replay", label: "Replay", icon: History },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const status = useShellStatus();
  const { ui } = useUiLayout();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useTabSummary(status);
  useEffect(() => {
    document.documentElement.dataset["focus"] = ui.focus ? "true" : "false";
  }, [ui.focus]);

  return (
    <div className={"flex min-h-screen flex-col"}>
      <div className="sticky top-0 z-40">
        <AppHeader status={status} pathname={pathname} />
        <StatusBar status={status} />
      </div>
      <div key={pathname} className="ypx-page flex-1">
        {children}
      </div>
      <DisclaimerFooter />
      <BottomNav pathname={pathname} />
    </div>
  );
}

function AppHeader({ status, pathname }: { status: ShellStatus; pathname: string }) {
  const { ui, set } = useUiLayout();
  return (
    <header className="border-b border-border bg-background/90 backdrop-blur-xl">
      <div className="mx-auto grid h-14 w-full max-w-[1920px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 md:h-16 md:grid-cols-[auto_minmax(0,1fr)_auto] md:px-6">
        <Link to="/" className="flex min-w-0 items-center gap-2.5" aria-label="Ypx Bet — Terminal">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-gold font-display text-sm font-bold text-primary-foreground">
            YB
          </span>
          <span className="tv-display truncate text-xl text-foreground">Ypx Bet</span>
        </Link>

        <nav aria-label="Seções" className="hidden h-full items-stretch justify-center gap-1 md:flex">
          {TABS.map((t) => {
            const active = t.to === "/" ? pathname === "/" : pathname.startsWith(t.to);
            return (
              <Link
                key={t.to}
                to={t.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center px-4 font-display text-sm font-semibold uppercase tracking-wider transition-colors",
                  active ? "text-gold" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                {active && <span aria-hidden className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-gold" />}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <LiveIndicator connection={status.connection} />
          {status.balance != null && (
            <div className="hidden flex-col items-end leading-tight sm:flex">
              <span className="ypx-label text-[0.65rem]">Banca</span>
              <span className="ypx-num text-sm font-semibold text-foreground">
                {formatMoney(status.balance, status.currency)}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => set({ focus: !ui.focus })}
            aria-pressed={ui.focus}
            aria-label={ui.focus ? "Sair do foco nas apostas" : "Foco nas apostas"}
            title="Foco nas apostas"
            className={cn(
              "flex min-h-11 min-w-11 items-center justify-center rounded-md border px-2 transition-colors",
              ui.focus ? "border-gold/60 bg-gold-soft text-gold" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <Focus className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
          <CloudButton />
          <SettingsMenu />
        </div>
      </div>
    </header>
  );
}

function LiveIndicator({ connection }: { connection: ShellStatus["connection"] }) {
  if (connection == null) return null;
  const meta =
    connection === "live"
      ? { label: "Ao vivo", dot: "bg-success", text: "text-success", ring: true }
      : connection === "offline"
        ? { label: "Offline", dot: "bg-destructive", text: "text-destructive", ring: false }
        : { label: connection === "reconnecting" ? "Reconectando" : "Conectando", dot: "bg-warning", text: "text-warning", ring: false };
  return (
    <span
      role="status"
      className={cn("flex items-center gap-2 rounded-full border border-border bg-surface px-2.5 py-1 font-display text-xs font-bold uppercase tracking-wider", meta.text)}
    >
      <span className="relative flex size-2">
        {meta.ring && <span aria-hidden className={cn("ypx-live-ring absolute inset-0 rounded-full", meta.dot)} />}
        <span aria-hidden className={cn("relative size-2 rounded-full", meta.dot)} />
      </span>
      <span className="hidden sm:inline">{meta.label}</span>
      <span className="sr-only sm:hidden">{meta.label}</span>
    </span>
  );
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const pct = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")}%`;

export function StatusBar({ status }: { status: ShellStatus }) {
  const now = useNow();
  const [open, setOpen] = useState(true);
  const countdown =
    status.nextCycleAt != null
      ? (() => {
          const sec = Math.max(0, Math.ceil((status.nextCycleAt - now) / 1000));
          return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
        })()
      : "—";
  const pnl = status.todayPnl;
  const items: { label: string; value: ReactNode; tone?: string | undefined }[] = [
    {
      label: "Lucro do dia",
      value: pnl == null ? "—" : `${pnl > 0 ? "▲ " : pnl < 0 ? "▼ " : ""}${formatMoney(pnl, status.currency, { signed: true })}`,
      tone: pnl == null || pnl === 0 ? undefined : pnl > 0 ? "text-success" : "text-destructive",
    },
    { label: "Ativas", value: status.active ?? "—" },
    { label: "Acerto", value: status.hitRate == null ? "—" : pct(status.hitRate) },
    { label: "Regime", value: status.regime ?? "—" },
    { label: "Próximo ciclo", value: countdown, tone: "text-gold" },
  ];

  return (
    <div className="border-b border-border bg-surface/95 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1920px] items-center gap-2 px-3 md:px-6">
        <dl
          className={cn(
            "grid min-w-0 flex-1 grid-cols-3 gap-x-4 gap-y-1 py-2 sm:grid-cols-5",
            !open && "max-sm:hidden",
          )}
        >
          {items.map((it) => (
            <div key={it.label} className="min-w-0">
              <dt className="ypx-label truncate text-[0.65rem]">{it.label}</dt>
              <dd className={cn("ypx-num truncate text-sm font-semibold text-foreground transition-colors", it.tone)}>{it.value}</dd>
            </div>
          ))}
        </dl>
        {!open && (
          <p className="ypx-num flex-1 py-2 text-sm text-muted-foreground sm:hidden">
            {items[0]!.value} · {status.active ?? 0} ativas · {countdown}
          </p>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "Recolher resumo" : "Mostrar resumo"}
          className="flex min-h-11 min-w-11 items-center justify-center text-muted-foreground sm:hidden"
        >
          <Activity className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </div>
  );
}

function BottomNav({ pathname }: { pathname: string }) {
  const item = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 font-display text-[0.7rem] font-semibold uppercase tracking-wider";
  const on = (a: boolean) => (a ? "text-gold" : "text-muted-foreground");
  return (
    <nav
      aria-label="Navegação principal"
      className="ypx-safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur-xl md:hidden"
    >
      <div className="flex">
        <Link to="/" className={cn(item, on(pathname === "/"))}>
          <LayoutDashboard className="size-5" strokeWidth={1.75} aria-hidden />
          Terminal
        </Link>
        <Link to="/supremo" className={cn(item, on(pathname.startsWith("/supremo")))}>
          <Crown className="size-5" strokeWidth={1.75} aria-hidden />
          Supremo
        </Link>
        <Link to="/" hash="apostas" className={cn(item, "text-muted-foreground")}>
          <Ticket className="size-5" strokeWidth={1.75} aria-hidden />
          Apostas
        </Link>
        <Link to="/replay" className={cn(item, on(pathname.startsWith("/replay")))}>
          <History className="size-5" strokeWidth={1.75} aria-hidden />
          Mais
        </Link>
      </div>
    </nav>
  );
}

/** Título da aba com resumo e ícone com ponto verde/vermelho conforme o dia. */
function useTabSummary(status: ShellStatus) {
  useEffect(() => {
    if (status.active == null && status.todayPnl == null) return;
    const parts: string[] = [];
    if (status.active != null) parts.push(`${status.active} ativa${status.active === 1 ? "" : "s"}`);
    if (status.todayPnl != null) parts.push(formatMoney(status.todayPnl, status.currency, { signed: true }));
    parts.push("Ypx Bet");
    document.title = parts.join(" · ");
  }, [status.active, status.todayPnl, status.currency]);

  const tone = status.todayPnl == null || status.todayPnl === 0 ? 0 : status.todayPnl > 0 ? 1 : -1;
  useEffect(() => {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const css = getComputedStyle(document.documentElement);
      const color = (v: string) => css.getPropertyValue(v).trim();
      ctx.fillStyle = color("--gold");
      ctx.beginPath();
      ctx.roundRect(4, 4, 56, 56, 12);
      ctx.fill();
      ctx.fillStyle = color("--primary-foreground");
      ctx.font = "bold 30px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Y", 30, 34);
      if (tone !== 0) {
        ctx.fillStyle = color(tone > 0 ? "--success" : "--destructive");
        ctx.strokeStyle = color("--background");
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(48, 48, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.type = "image/png";
      link.href = c.toDataURL("image/png");
    } catch {
      /* silencioso */
    }
  }, [tone]);
}

function CloudButton() {
  const user = useCloudUser();
  return (
    <Link
      to="/auth"
      title={user ? "Conectado: o automático roda mesmo com a página fechada" : "Entrar para manter o automático rodando com a página fechada"}
      aria-label={user ? "Conta conectada" : "Entrar"}
      className={cn(
        "flex min-h-11 items-center gap-1.5 rounded-md border px-2 text-xs font-semibold transition-colors",
        user ? "border-success/50 text-success" : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {user ? <Cloud className="size-4" aria-hidden /> : <CloudOff className="size-4" aria-hidden />}
      <span className="hidden lg:inline">{user ? "Na nuvem" : "Entrar"}</span>
    </Link>
  );
}
