import {
  applyLockedOfficeOptions,
  DEFAULT_GOAL,
  parseFloorMode,
  parseModel,
  parseProvider,
  resolveFloor,
  type FloorMode,
  type LockedOfficeOptions,
  type Provider,
  type SimSpeed,
} from "../shared/types.js";

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
  floor: FloorMode;
}

export const DEFAULT_SETTINGS: GameSettings = {
  provider: "mock",
  model: "scripted-office",
  goal: DEFAULT_GOAL,
  sound: true,
  speed: "normal",
  floor: "scripted",
};

const KEY = "agentic-office-settings-v3";

export function loadSettings(): GameSettings {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const loaded = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as GameSettings;
    loaded.floor = resolveFloor(loaded.provider, loaded.floor);
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

let locksCache: LockedOfficeOptions | undefined;
let locksFetched = false;

function sanitizeLocks(raw: LockedOfficeOptions | undefined): LockedOfficeOptions {
  const provider = parseProvider(raw?.provider);
  const model = parseModel(raw?.model);
  const floor = parseFloorMode(raw?.floor);
  return {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(floor ? { floor } : {}),
  };
}

function embeddedLockedOptions(): LockedOfficeOptions {
  if (typeof window === "undefined") return {};
  return sanitizeLocks((window as Window & { __OFFICE_LOCKS__?: LockedOfficeOptions }).__OFFICE_LOCKS__);
}

/** Last known pins (embedded page config or `/health`). */
export function peekLockedOptions(): LockedOfficeOptions | undefined {
  if (locksCache) return locksCache;
  const embedded = embeddedLockedOptions();
  return hasLockedOptions(embedded) ? embedded : undefined;
}

export function hasLockedOptions(locks: LockedOfficeOptions): boolean {
  return Boolean(locks.provider || locks.model || locks.floor);
}

async function fetchLocksFrom(url: string): Promise<LockedOfficeOptions> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) return {};
    const data = (await res.json()) as { locks?: LockedOfficeOptions };
    return sanitizeLocks(data.locks);
  } catch {
    return {};
  } finally {
    window.clearTimeout(timer);
  }
}

/** Pins from harness env. Production injects them on the page; `/health` is the fallback. */
export async function fetchLockedOptions(): Promise<LockedOfficeOptions> {
  const embedded = embeddedLockedOptions();
  if (hasLockedOptions(embedded)) {
    locksCache = embedded;
    locksFetched = true;
    return embedded;
  }
  if (locksFetched && locksCache) return locksCache;
  const fromHealth = await fetchLocksFrom("/health");
  const next = hasLockedOptions(fromHealth) ? fromHealth : await fetchLocksFrom("/config");
  locksCache = hasLockedOptions(next) ? next : fromHealth;
  locksFetched = true;
  return locksCache;
}

export function settingsWithLocks(settings: GameSettings, locks: LockedOfficeOptions): GameSettings {
  return applyLockedOfficeOptions(settings, locks);
}
