import { useEffect, useState } from "react";
import { Settings, Volume2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useUiLayout, type UiLayout } from "@/hooks/useUiLayout";
import { cn } from "@/lib/utils";
import {
  SOUND_LABELS,
  getMutedSounds,
  isAllSoundsMuted,
  playNotificationSound,
  setAllSoundsEnabled,
  setSoundEnabled,
  type NotificationSound,
} from "@/lib/notification-sounds";

const KINDS = Object.keys(SOUND_LABELS) as NotificationSound[];

export function SettingsMenu() {
  const [muted, setMuted] = useState<NotificationSound[]>([]);
  const [allMuted, setAllMuted] = useState(false);
  useEffect(() => {
    setMuted(getMutedSounds());
    setAllMuted(isAllSoundsMuted());
  }, []);

  const toggle = (kind: NotificationSound, on: boolean) => {
    setSoundEnabled(kind, on);
    setMuted(getMutedSounds());
  };

  const toggleAll = (on: boolean) => {
    setAllSoundsEnabled(on);
    setAllMuted(!on);
  };

  return (
    <Sheet>
      <SheetTrigger
        aria-label="Configurações"
        className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm text-muted-foreground transition-colors hover:border-gold/40 hover:text-foreground"
      >
        <Settings className="size-4" strokeWidth={1.75} aria-hidden />
        <span className="hidden lg:inline">Configurações</span>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Configurações</SheetTitle>
          <SheetDescription>Leitura, densidade e sons de notificação.</SheetDescription>
        </SheetHeader>
        <ReadingPrefs />
        <div className="mt-6 space-y-3 px-4 pb-6">
          <p className="ypx-label">Sons</p>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Todos os sons</p>
              <p className="text-xs text-muted-foreground">Desativa (ou reativa) todas as notificações sonoras de uma vez</p>
            </div>
            <Switch
              checked={!allMuted}
              onCheckedChange={toggleAll}
              aria-label="Todos os sons"
            />
          </div>
          {KINDS.map((kind) => {
            const on = !allMuted && !muted.includes(kind);
            return (
              <div
                key={kind}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{SOUND_LABELS[kind].title}</p>
                  <p className="text-xs text-muted-foreground">{SOUND_LABELS[kind].desc}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={`Ouvir som ${SOUND_LABELS[kind].title}`}
                    onClick={() => playNotificationSound(kind, true)}
                    className="rounded-md p-1.5 text-muted-foreground hover:text-foreground"
                  >
                    <Volume2 className="size-4" />
                  </button>
                  <Switch
                    checked={on}
                    onCheckedChange={(v) => toggle(kind, v)}
                    aria-label={`Som ${SOUND_LABELS[kind].title}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Choice<K extends "density" | "textSize" | "contrast">({
  k,
  label,
  options,
}: {
  k: K;
  label: string;
  options: { value: UiLayout[K]; label: string }[];
}) {
  const { ui, set } = useUiLayout();
  return (
    <div role="radiogroup" aria-label={label} className="space-y-1.5">
      <p className="ypx-label">{label}</p>
      <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-surface-2 p-1">
        {options.map((o) => {
          const active = ui[k] === o.value;
          return (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => set({ [k]: o.value } as Partial<UiLayout>)}
              className={cn(
                "min-h-10 rounded px-3 text-sm transition-colors",
                active ? "bg-gold text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ReadingPrefs() {
  const { ui, set } = useUiLayout();
  return (
    <div className="mt-6 space-y-4 px-4">
      <Choice k="density" label="Densidade" options={[{ value: "comfortable", label: "Confortável" }, { value: "compact", label: "Compacto" }]} />
      <Choice k="textSize" label="Tamanho do texto" options={[{ value: "normal", label: "Normal" }, { value: "large", label: "Grande" }]} />
      <Choice k="contrast" label="Contraste" options={[{ value: "default", label: "Padrão" }, { value: "high", label: "Alto" }]} />
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Foco nas apostas</p>
          <p className="text-xs text-muted-foreground">Mostra só apostas ativas e a melhor aposta, com fonte maior</p>
        </div>
        <Switch checked={ui.focus} onCheckedChange={(v) => set({ focus: v })} aria-label="Foco nas apostas" />
      </div>
    </div>
  );
}
