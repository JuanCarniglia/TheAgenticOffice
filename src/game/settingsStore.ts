import { DEFAULT_GOAL, type Provider, type SimSpeed } from "../shared/types.js";

/** Previous close-one preset lines. sessionStorage still has these from earlier play. */
const RETIRED_CLOSE_ONE = new Set([
  "Close a paper sale with the customer sitting in the lobby.",
  "Close a paper sale with the caller on the line.",
]);

export interface GameSettings {
  provider: Provider;
  model: string;
  goal: string;
  sound: boolean;
  speed: SimSpeed;
}

export const DEFAULT_SETTINGS: GameSettings = {
  provider: "mock",
  model: "scripted-office",
  goal: DEFAULT_GOAL,
  sound: true,
  speed: "normal",
};

const KEY = "agentic-office-settings-v3";

export function loadSettings(): GameSettings {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const loaded = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as GameSettings;
    if (RETIRED_CLOSE_ONE.has(loaded.goal)) {
      loaded.goal = DEFAULT_GOAL;
      saveSettings(loaded);
    }
    return loaded;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GameSettings): void {
  sessionStorage.setItem(KEY, JSON.stringify(settings));
}
