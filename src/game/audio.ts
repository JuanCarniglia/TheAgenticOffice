let ctx: AudioContext | null = null;
let theme: HTMLAudioElement | null = null;

function themeEl(): HTMLAudioElement {
  if (!theme) {
    theme = new Audio("/assets/theme.mp3");
    theme.loop = true;
    theme.volume = 0.32;
    theme.preload = "auto";
  }
  return theme;
}

/** Start downloading the title theme during boot. */
export function preloadMenuTheme(): void {
  themeEl();
}

/** Loop the title theme on Intro / Settings. Needs a user click the first time. */
export function playMenuTheme(enabled: boolean): void {
  const el = themeEl();
  if (!enabled) {
    el.pause();
    return;
  }
  void el.play().catch(() => undefined);
}

export function stopMenuTheme(): void {
  if (!theme) return;
  theme.pause();
  theme.currentTime = 0;
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  ctx ??= new AudioContext();
  return ctx;
}

export function beep(enabled: boolean, freq = 520, ms = 70): void {
  if (!enabled) return;
  const ac = audio();
  if (!ac) return;
  void ac.resume();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  gain.gain.value = 0.035;
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + ms / 1000);
}

export function bootBeep(enabled: boolean): void {
  beep(enabled, 220, 40);
  window.setTimeout(() => beep(enabled, 330, 40), 80);
  window.setTimeout(() => beep(enabled, 440, 80), 160);
}

/** Classic two-burst office desk phone. */
export function ringPhone(enabled: boolean): void {
  if (!enabled) return;
  const ac = audio();
  if (!ac) return;
  void ac.resume();
  const now = ac.currentTime;
  const burst = (at: number) => {
    const make = (freq: number) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.07, now + at + 0.02);
      gain.gain.setValueAtTime(0.07, now + at + 0.38);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.42);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.44);
    };
    make(440);
    make(480);
  };
  burst(0);
  burst(0.7);
}

export function phonePickup(enabled: boolean): void {
  if (!enabled) return;
  const ac = audio();
  if (!ac) return;
  void ac.resume();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "square";
  osc.frequency.value = 180;
  gain.gain.value = 0.04;
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + 0.06);
}

export function phoneTransfer(enabled: boolean): void {
  if (!enabled) return;
  beep(enabled, 880, 50);
  window.setTimeout(() => beep(enabled, 660, 80), 90);
}

export function phoneHangup(enabled: boolean): void {
  if (!enabled) return;
  const ac = audio();
  if (!ac) return;
  void ac.resume();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "square";
  osc.frequency.value = 140;
  gain.gain.value = 0.045;
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + 0.08);
}

/** Desk bell for a $100+ close. */
export function ringBell(enabled: boolean): void {
  if (!enabled) return;
  const ac = audio();
  if (!ac) return;
  void ac.resume();
  const now = ac.currentTime;
  const ding = (freq: number, at: number, dur: number) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now + at);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.55, now + at + dur);
    gain.gain.setValueAtTime(0.0001, now + at);
    gain.gain.exponentialRampToValueAtTime(0.12, now + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(now + at);
    osc.stop(now + at + dur);
  };
  ding(1760, 0, 0.55);
  ding(1320, 0.16, 0.7);
}
