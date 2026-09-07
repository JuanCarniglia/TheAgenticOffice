import { DAY_END, DAY_START, TICK_MINUTES, type OfficeClock } from "./types.js";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI"];

export function startOfWeek(): OfficeClock {
  return { day: 0, minutes: DAY_START };
}

export function formatClock(clock: OfficeClock): string {
  const day = DAYS[clock.day % DAYS.length] ?? "MON";
  const h = Math.floor(clock.minutes / 60);
  const m = clock.minutes % 60;
  return `${day} ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function advanceClock(clock: OfficeClock): OfficeClock {
  const next = { ...clock, minutes: clock.minutes + TICK_MINUTES };
  if (next.minutes >= DAY_END + TICK_MINUTES) {
    return { day: clock.day + 1, minutes: DAY_START };
  }
  return next;
}

export function clockKey(clock: OfficeClock): string {
  return `${clock.day}:${clock.minutes}`;
}
