/** Wall-clock pause before an agent starts talking. */
export function thinkDelayMs(text: string): number {
  return Math.min(1400, 480 + text.length * 11);
}

export function typeDelayMs(ch: string): number {
  if (/[.?!]/.test(ch)) return 150;
  if (/[,;:]/.test(ch)) return 85;
  if (ch === " ") return 22;
  return 28;
}

export function typeDurationMs(text: string): number {
  let n = 0;
  for (const ch of text) n += typeDelayMs(ch);
  return n;
}

export function charsRevealed(text: string, elapsedMs: number): number {
  let t = elapsedMs;
  let i = 0;
  while (i < text.length && t >= typeDelayMs(text[i]!)) {
    t -= typeDelayMs(text[i]!);
    i += 1;
  }
  return i;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
