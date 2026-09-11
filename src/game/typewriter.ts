export {
  charsRevealed,
  linePlayMs,
  thinkDelayMs,
  typeDelayMs,
  typeDurationMs,
} from "../shared/speech.js";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
