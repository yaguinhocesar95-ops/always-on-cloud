import { useCallback, useEffect, useSyncExternalStore } from "react";

/** Preferências só de apresentação (não mexem em regras ou cálculos). */
export const UI_LAYOUT_KEY = "ypx-ui-layout-v1";

export type UiLayout = {
  density: "comfortable" | "compact";
  textSize: "normal" | "large";
  contrast: "default" | "high";
  focus: boolean;
  /** Seções abertas/fechadas, por id. */
  sections: Record<string, boolean>;
  /** Abas lembradas, por id do grupo. */
  tabs: Record<string, string>;
};

export const DEFAULT_UI_LAYOUT: UiLayout = {
  density: "comfortable",
  textSize: "normal",
  contrast: "default",
  focus: false,
  sections: {},
  tabs: {},
};

export function readUiLayout(): UiLayout {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(UI_LAYOUT_KEY) : null;
    if (!raw) return DEFAULT_UI_LAYOUT;
    const p = JSON.parse(raw) as Partial<UiLayout>;
    return {
      density: p.density === "compact" ? "compact" : "comfortable",
      textSize: p.textSize === "large" ? "large" : "normal",
      contrast: p.contrast === "high" ? "high" : "default",
      focus: p.focus === true,
      sections: p.sections && typeof p.sections === "object" ? p.sections : {},
      tabs: p.tabs && typeof p.tabs === "object" ? p.tabs : {},
    };
  } catch {
    return DEFAULT_UI_LAYOUT;
  }
}

let state: UiLayout | null = null;
const listeners = new Set<() => void>();

function current(): UiLayout {
  if (state == null) state = readUiLayout();
  return state;
}

export function writeUiLayout(patch: Partial<UiLayout>) {
  state = { ...current(), ...patch };
  try {
    localStorage.setItem(UI_LAYOUT_KEY, JSON.stringify(state));
  } catch {
    /* silencioso */
  }
  listeners.forEach((l) => l());
}

/** Só para testes: esquece o estado em memória. */
export function resetUiLayoutCache() {
  state = null;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useUiLayout() {
  const ui = useSyncExternalStore(subscribe, current, () => DEFAULT_UI_LAYOUT);

  // Tamanho de texto e contraste valem para a página inteira.
  useEffect(() => {
    const el = document.documentElement;
    el.dataset["text"] = ui.textSize;
    el.dataset["contrast"] = ui.contrast;
  }, [ui.textSize, ui.contrast]);

  const set = useCallback((patch: Partial<UiLayout>) => writeUiLayout(patch), []);
  const setSection = useCallback(
    (id: string, open: boolean) => writeUiLayout({ sections: { ...current().sections, [id]: open } }),
    [],
  );
  const setTab = useCallback(
    (id: string, tab: string) => writeUiLayout({ tabs: { ...current().tabs, [id]: tab } }),
    [],
  );
  return { ui, set, setSection, setTab };
}
