/**
 * Sound, synthesised.
 *
 * A handful of short blips generated with WebAudio oscillators. No audio files
 * means nothing extra to download, nothing to cache-bust, and no licensing
 * question — and it suits a site that ships no webfonts either.
 *
 * Muted state persists. The context is created on the first real interaction,
 * because browsers refuse to start one before that.
 */
import { KEYS, read, write } from "./storage";

let context: AudioContext | null = null;
let muted = read<boolean>(KEYS.muted, false);

export const isMuted = () => muted;

export function setMuted(value: boolean) {
  muted = value;
  write(KEYS.muted, value);
}

function ensureContext(): AudioContext | null {
  if (muted) return null;
  if (!context) {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  // A context can end up closed after a device change; treat it as unavailable
  // rather than throwing on the next note.
  if (context.state === "closed") return null;
  if (context.state === "suspended") void context.resume();
  return context;
}

type Blip = { freq: number; to?: number; ms: number; type?: OscillatorType; gain?: number };

function play({ freq, to, ms, type = "sine", gain = 0.06 }: Blip) {
  try {
    playUnsafe({ freq, to, ms, type, gain });
  } catch {
    // A browser that refuses to make a sound — headless, autoplay-blocked, no
    // audio device — must not take the game action down with it. The blip is
    // decoration; the pet still counts.
  }
}

function playUnsafe({ freq, to, ms, type = "sine", gain = 0.06 }: Blip) {
  const ctx = ensureContext();
  if (!ctx) return;

  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(freq, ctx.currentTime);
  if (to) oscillator.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + ms / 1000);

  // A short attack and a smooth decay: a raw gate would click.
  envelope.gain.setValueAtTime(0.0001, ctx.currentTime);
  envelope.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + 0.01);
  envelope.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);

  oscillator.connect(envelope).connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + ms / 1000 + 0.02);
}

export const sfx = {
  pet: () => play({ freq: 620, to: 880, ms: 90, type: "triangle" }),
  superPet: () => play({ freq: 520, to: 1240, ms: 260, type: "triangle", gain: 0.08 }),
  throw: () => play({ freq: 300, to: 520, ms: 130, type: "sawtooth", gain: 0.04 }),
  perfect: () => {
    play({ freq: 780, to: 1180, ms: 180, type: "triangle", gain: 0.08 });
    window.setTimeout(() => play({ freq: 1180, to: 1560, ms: 220, type: "triangle", gain: 0.06 }), 90);
  },
  good: () => play({ freq: 660, to: 820, ms: 150, type: "triangle" }),
  miss: () => play({ freq: 300, to: 170, ms: 260, type: "sine", gain: 0.05 }),
  jump: () => play({ freq: 440, to: 720, ms: 90, type: "square", gain: 0.035 }),
  bone: () => play({ freq: 980, to: 1320, ms: 70, type: "triangle", gain: 0.05 }),
  crash: () => play({ freq: 220, to: 90, ms: 380, type: "sawtooth", gain: 0.07 }),
  dig: () => play({ freq: 240, to: 180, ms: 200, type: "sawtooth", gain: 0.05 }),
  found: () => {
    play({ freq: 700, to: 1050, ms: 150, type: "triangle", gain: 0.08 });
    window.setTimeout(() => play({ freq: 1050, to: 1400, ms: 260, type: "triangle", gain: 0.07 }), 130);
  },
  milestone: () => {
    [0, 120, 240].forEach((delay, index) =>
      window.setTimeout(
        () => play({ freq: 620 + index * 220, to: 900 + index * 240, ms: 260, type: "triangle", gain: 0.07 }),
        delay,
      ),
    );
  },
};
