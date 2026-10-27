/**
 * Notification chime: a soft three-note bell, synthesized with Web Audio (no sound file).
 * Browsers only allow audio after the person has interacted with the page, so the audio
 * context is unlocked on the first click or key press.
 */
const KEY = 'rgk-notify-sound';
let ctx: AudioContext | null = null;

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Only a preference; the default (on) applies.
  }
}

function audio(): AudioContext | null {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

/** Call once at start-up. Returns a cleanup function. */
export function unlockAudioOnFirstGesture(): () => void {
  const unlock = () => {
    void audio()?.resume().catch(() => {});
    off();
  };
  const off = () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  return off;
}

function ring(c: AudioContext) {
  const t0 = c.currentTime + 0.02;
  const master = c.createGain();
  master.gain.value = 0.16;
  master.connect(c.destination);
  // E6 → G6 → C7, each a sine with a quiet octave on top for a bell-like ring.
  const notes: [number, number][] = [
    [1318.51, 0],
    [1567.98, 0.1],
    [2093.0, 0.2],
  ];
  for (const [freq, at] of notes) {
    for (const [mult, level] of [
      [1, 1],
      [2, 0.16],
    ] as const) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(level, t0 + at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.7);
      osc.connect(gain).connect(master);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.75);
    }
  }
}

/** Plays the chime if sound is on and the browser allows audio. Never throws. */
export function playChime() {
  if (!soundEnabled()) return;
  const c = audio();
  if (!c) return;
  if (c.state === 'running') ring(c);
  else
    void c
      .resume()
      .then(() => c.state === 'running' && ring(c))
      .catch(() => {});
}
