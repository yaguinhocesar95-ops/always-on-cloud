export type NotificationSound = "entrada" | "sucesso" | "sugestao" | "erro" | "aviso" | "confirmacao";

export const SOUND_LABELS: Record<NotificationSound, { title: string; desc: string }> = {
  entrada: { title: "Entrada", desc: "Quando o preço de entrada é atingido" },
  sucesso: { title: "Sucesso", desc: "Estrelinha conquistada" },
  sugestao: { title: "Sugestão calculada", desc: "Quando uma sugestão de custos é calculada" },
  erro: { title: "Erro", desc: "Limite de perda atingido ou falha" },
  aviso: { title: "Aviso", desc: "Queda muito rápida detectada" },
  confirmacao: { title: "Confirmação", desc: "Confirmações rápidas (plim)" },
};

const MUTE_KEY = "ypx-muted-sounds";
const MUTE_ALL_KEY = "ypx-all-sounds-muted";

export function getMutedSounds(): NotificationSound[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(MUTE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function setSoundEnabled(kind: NotificationSound, enabled: boolean) {
  const set = new Set(getMutedSounds());
  if (enabled) set.delete(kind);
  else set.add(kind);
  localStorage.setItem(MUTE_KEY, JSON.stringify([...set]));
}

export function isAllSoundsMuted(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(MUTE_ALL_KEY) === "1";
}

export function setAllSoundsEnabled(enabled: boolean) {
  localStorage.setItem(MUTE_ALL_KEY, enabled ? "0" : "1");
}

type AudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

// [frequência, início (s), duração (s), timbre]
type Note = readonly [number, number, number, OscillatorType?];

/**
 * Vinhetas originais no clima de programa de auditório/perguntas:
 * suspense com tambor, fanfarra de acerto, "errou" descendente.
 */
const CUES: Record<NotificationSound, { notes: Note[]; drum?: [number, number]; vol: number }> = {
  // "Posso perguntar?" — suspense subindo com rufar
  entrada: {
    vol: 0.2,
    drum: [0, 0.6],
    notes: [
      [196, 0, 0.18, "sawtooth"],
      [246.94, 0.2, 0.18, "sawtooth"],
      [293.66, 0.4, 0.18, "sawtooth"],
      [392, 0.62, 0.5, "square"],
      [493.88, 0.62, 0.5, "triangle"],
    ],
  },
  // "Certa resposta!" — fanfarra
  sucesso: {
    vol: 0.22,
    drum: [0, 0.35],
    notes: [
      [523.25, 0.35, 0.12, "square"],
      [523.25, 0.5, 0.12, "square"],
      [523.25, 0.65, 0.12, "square"],
      [659.25, 0.8, 0.3, "square"],
      [587.33, 1.12, 0.14, "square"],
      [659.25, 1.28, 0.14, "square"],
      [783.99, 1.44, 0.7, "square"],
      [1046.5, 1.44, 0.7, "triangle"],
      [392, 1.44, 0.7, "sawtooth"],
    ],
  },
  // "Sugestão calculada" — brilho curto de confirmação
  sugestao: {
    vol: 0.2,
    notes: [
      [659.25, 0, 0.12, "triangle"],
      [783.99, 0.12, 0.12, "triangle"],
      [1046.5, 0.24, 0.35, "triangle"],
    ],
  },
  // "Que pena, você errou" — trombone triste
  erro: {
    vol: 0.22,
    notes: [
      [392, 0, 0.35, "sawtooth"],
      [369.99, 0.38, 0.35, "sawtooth"],
      [349.23, 0.76, 0.35, "sawtooth"],
      [329.63, 1.14, 0.9, "sawtooth"],
    ],
  },
  // "Está certo disso?" — alerta tenso
  aviso: {
    vol: 0.18,
    notes: [
      [880, 0, 0.12, "square"],
      [698.46, 0.14, 0.12, "square"],
      [880, 0.28, 0.12, "square"],
      [698.46, 0.42, 0.12, "square"],
      [220, 0.58, 0.5, "sawtooth"],
    ],
  },
  // "Vamos à próxima pergunta" — plim
  confirmacao: {
    vol: 0.18,
    notes: [
      [783.99, 0, 0.1, "triangle"],
      [1174.66, 0.1, 0.3, "triangle"],
    ],
  },
};

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// Navegadores só liberam áudio depois de um clique/tecla: destrava na primeira interação.
if (typeof window !== "undefined") {
  const unlock = () => {
    const c = getContext();
    if (c && c.state === "running") {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    }
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

function drumRoll(c: AudioContext, out: AudioNode, start: number, dur: number) {
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  const hit = Math.floor(c.sampleRate * 0.045);
  for (let i = 0; i < len; i++) {
    const phase = (i % hit) / hit;
    data[i] = (Math.random() * 2 - 1) * Math.exp(-phase * 6) * (0.4 + (0.6 * i) / len);
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 900;
  const g = c.createGain();
  g.gain.value = 0.6;
  src.connect(filter).connect(g).connect(out);
  src.start(start);
}

export function playNotificationSound(kind: NotificationSound, force = false) {
  if (!force && (isAllSoundsMuted() || getMutedSounds().includes(kind))) return;
  try {
    const c = getContext();
    if (!c) return;
    const cue = CUES[kind];
    const master = c.createGain();
    master.gain.setValueAtTime(cue.vol, c.currentTime);
    master.connect(c.destination);
    const t0 = c.currentTime + 0.02;

    if (cue.drum) drumRoll(c, master, t0 + cue.drum[0], cue.drum[1]);

    for (const [frequency, delay, duration, type] of cue.notes) {
      const osc = c.createOscillator();
      const env = c.createGain();
      const start = t0 + delay;
      const end = start + duration;
      osc.type = type ?? "triangle";
      osc.frequency.setValueAtTime(frequency, start);
      if (kind === "erro" && delay > 1) {
        // vibrato no final do "errou"
        const lfo = c.createOscillator();
        const lfoGain = c.createGain();
        lfo.frequency.value = 6;
        lfoGain.gain.value = 8;
        lfo.connect(lfoGain).connect(osc.frequency);
        lfo.start(start);
        lfo.stop(end);
      }
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(0.4, start + 0.02);
      env.gain.setValueAtTime(0.4, Math.max(start + 0.02, end - 0.08));
      env.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(env).connect(master);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  } catch {
    // áudio indisponível neste navegador
  }
}
