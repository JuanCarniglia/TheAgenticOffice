import { DEFAULT_GOAL, type Provider, type SimSpeed } from "../shared/types.js";

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
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GameSettings): void {
  sessionStorage.setItem(KEY, JSON.stringify(settings));
}
