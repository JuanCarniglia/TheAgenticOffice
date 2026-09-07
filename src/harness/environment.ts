import type { AgentId, Meeting, OfficeEvent, Ticket, ZoneId } from "../shared/types.js";
import { AGENT_IDS, workerById } from "../shared/roster.js";
import { clockKey, formatClock } from "../shared/clock.js";
import { rememberShort } from "./memory.js";
import { defaultBoard, seedQueues, type OfficeState } from "./officeState.js";
import { STANDUP_LINES } from "./salesScript.js";

export interface ScheduleHit {
  id: string;
  label: string;
}

const SCHEDULE: Array<{ minutes: number; id: string; label: string }> = [
  { minutes: 9 * 60, id: "login", label: "LOG IN" },
  { minutes: 10 * 60, id: "standup", label: "DAILY STANDUP" },
  { minutes: 12 * 60, id: "lunch", label: "LUNCH" },
  { minutes: 17 * 60, id: "wrap", label: "WRAP" },
];

export function dueSchedule(state: OfficeState): ScheduleHit | null {
  for (const ev of SCHEDULE) {
    const key = `${state.clock.day}:${ev.id}`;
    if (state.clock.minutes === ev.minutes && !state.firedSchedule.includes(key)) {
      return { id: ev.id, label: ev.label };
    }
  }
  return null;
}

export function markFired(state: OfficeState, id: string): void {
  state.firedSchedule.push(`${state.clock.day}:${id}`);
}

export function startMeeting(
  state: OfficeState,
  title: string,
  topic: string,
  attendees: AgentId[],
  turns = 4,
): Meeting {
  const meeting: Meeting = {
    id: `mtg-${clockKey(state.clock)}`,
    title,
    zone: "conference_room",
    topic,
    attendees,
    speakerIndex: 0,
    remainingTurns: turns,
    log: [],
  };
  state.meeting = meeting;
  return meeting;
}

export function nextMeetingSpeaker(state: OfficeState): AgentId | null {
  if (!state.meeting || state.meeting.remainingTurns <= 0) return null;
  const { attendees, speakerIndex } = state.meeting;
  if (!attendees.length) return null;
  return attendees[speakerIndex % attendees.length] ?? null;
}

export function recordMeetingLine(state: OfficeState, from: AgentId, text: string): void {
  if (!state.meeting) return;
  state.meeting.log.push({ from, text });
  state.meeting.speakerIndex += 1;
  state.meeting.remainingTurns -= 1;
}

export function endMeeting(state: OfficeState): Meeting | null {
  const done = state.meeting;
  state.meeting = null;
  return done;
}

export function applyLogin(state: OfficeState, emit: (e: OfficeEvent) => void): void {
  if (!state.tasks.length) {
    state.tasks = defaultBoard();
    seedQueues(state);
    emit({ type: "tasks_replaced", tasks: state.tasks.map((t) => ({ ...t })) });
    for (const id of AGENT_IDS) {
      emit({ type: "queue_update", agentId: id, queue: state.queues[id].map((t) => ({ ...t })) });
    }
  }
  const time = formatClock(state.clock);
  emit({ type: "clock", time, label: "LOG IN" });
  for (const id of AGENT_IDS) {
    rememberShort(state.shortTerm, id, `Logged in. Inbox: ${state.queues[id].length} tickets.`, time);
    emit({ type: "status", agentId: id, status: "logged in — checking inbox" });
  }
}

export function applyStandup(state: OfficeState, emit: (e: OfficeEvent) => void): void {
  const meeting = startMeeting(state, "Standup", "Sell the inbound caller.", [...AGENT_IDS], AGENT_IDS.length);
  emit({ type: "clock", time: formatClock(state.clock), label: "DAILY STANDUP" });
  emit({
    type: "meeting_start",
    title: meeting.title,
    topic: meeting.topic,
    attendees: meeting.attendees,
  });
  for (const id of AGENT_IDS) {
    state.positions[id] = "conference_room";
    emit({ type: "move_to", agentId: id, zone: "conference_room" });
  }
}

export function applyLunch(state: OfficeState, emit: (e: OfficeEvent) => void): void {
  emit({ type: "clock", time: formatClock(state.clock), label: "LUNCH" });
  for (const id of AGENT_IDS) {
    emit({ type: "status", agentId: id, status: "lunch at desk" });
  }
}

export function applyWrap(state: OfficeState, emit: (e: OfficeEvent) => void): void {
  emit({ type: "clock", time: formatClock(state.clock), label: "WRAP" });
  for (const id of AGENT_IDS) {
    emit({ type: "status", agentId: id, status: "wrapping the day" });
  }
}

export function scriptedMeetingTurn(state: OfficeState, emit: (e: OfficeEvent) => void): boolean {
  if (!state.meeting) return false;
  if (state.meeting.remainingTurns <= 0) {
    const done = endMeeting(state);
    if (done) emit({ type: "meeting_end", title: done.title });
    sendHome(state, emit);
    return true;
  }
  const speaker = nextMeetingSpeaker(state);
  if (!speaker) {
    const done = endMeeting(state);
    if (done) emit({ type: "meeting_end", title: done.title });
    sendHome(state, emit);
    return true;
  }
  const line = STANDUP_LINES[speaker];
  recordMeetingLine(state, speaker, line);
  rememberShort(state.shortTerm, speaker, `Standup: ${line}`, formatClock(state.clock));
  emit({ type: "meeting_say", agentId: speaker, text: line });
  emit({ type: "say", agentId: speaker, text: line });
  if (!state.meeting || state.meeting.remainingTurns <= 0) {
    const done = endMeeting(state);
    if (done) emit({ type: "meeting_end", title: done.title });
    sendHome(state, emit);
  }
  return true;
}

export function sendHome(state: OfficeState, emit: (e: OfficeEvent) => void): void {
  for (const id of AGENT_IDS) {
    const zone = workerById(id).home;
    state.positions[id] = zone;
    emit({ type: "move_to", agentId: id, zone });
  }
}

const LOITER: ZoneId[] = [
  "waiting",
  "entrance",
  "reception",
  "annex",
  "breakroom",
  "conference_room",
  "kitchen",
];

/** Jim/Dwight sit the desks. Pam stays at reception (left of the counter). */
export function recallWanderers(state: OfficeState, emit: (e: OfficeEvent) => void): void {
  if (state.meeting || state.beats.length) return;
  for (const id of ["jim", "dwight"] as const) {
    const here = state.positions[id];
    const home = workerById(id).home;
    if (here !== home && LOITER.includes(here)) {
      state.positions[id] = home;
      emit({ type: "move_to", agentId: id, zone: home });
      emit({ type: "status", agentId: id, status: "back at desk" });
    }
  }
  if (state.positions.pam !== "reception") {
    state.positions.pam = "reception";
    emit({ type: "move_to", agentId: "pam", zone: "reception" });
    emit({ type: "status", agentId: "pam", status: "at reception" });
  }
}

export function nextQueueItem(state: OfficeState, agentId: AgentId): Ticket | undefined {
  return state.queues[agentId].find((t) => t.status !== "done");
}
