import type { StockSku } from "./catalog.js";
export type { StockSku } from "./catalog.js";

export type Provider = "openai" | "anthropic" | "cursor" | "mock";

export type AgentId = "michael" | "pam" | "jim" | "dwight" | "angela";

export type OrgRole = "ceo" | "pm" | "sales" | "hr";

export type ZoneId =
  | "entrance"
  | "reception"
  | "waiting"
  | "manager_office"
  | "conference_room"
  | "bullpen_sales"
  | "bullpen_dwight"
  | "accounting"
  | "kitchen"
  | "breakroom"
  | "annex"
  | "water_cooler";

export type TaskStatus = "todo" | "doing" | "done";

export type SimSpeed = "slow" | "normal" | "fast";

export type MemoryKind = "interaction" | "requirement" | "gossip" | "decision";

export interface OfficeClock {
  day: number;
  minutes: number;
}

export interface Ticket {
  id: string;
  title: string;
  owner: AgentId;
  reporter: AgentId | "supervisor";
  status: TaskStatus;
  note: string;
  kind: "company" | "personal";
}

/** @deprecated use Ticket — kept as an alias for the Jira-style board */
export type Task = Ticket;

export interface MailNote {
  from: AgentId | "human" | "supervisor";
  message: string;
}

export interface WatercoolerPost {
  id: string;
  from: AgentId;
  text: string;
  time: string;
}

export interface DirectMessage {
  id: string;
  from: AgentId | "human";
  to: AgentId;
  text: string;
  time: string;
}

export interface Meeting {
  id: string;
  title: string;
  zone: ZoneId;
  topic: string;
  attendees: AgentId[];
  speakerIndex: number;
  remainingTurns: number;
  log: Array<{ from: AgentId; text: string }>;
}

export interface MemoryFact {
  id: string;
  agentId: AgentId;
  kind: MemoryKind;
  text: string;
  time: string;
}

export interface SessionConfig {
  goal: string;
  provider: Provider;
  model: string;
  speed: SimSpeed;
}

export type OfficeEvent =
  | {
      type: "session_started";
      goal: string;
      tasks: Ticket[];
      positions: Record<AgentId, ZoneId>;
      clock: string;
      queues: Record<AgentId, Ticket[]>;
      balance: number;
      todayEarnings: number;
      todayTokens: number;
      stock: StockSku[];
    }
  | { type: "clock"; time: string; label?: string }
  | { type: "say"; agentId: AgentId; text: string }
  | { type: "whisper"; agentId: AgentId; text: string }
  | { type: "watercooler"; from: AgentId; text: string; time: string }
  | { type: "dm"; from: AgentId | "human"; to: AgentId; text: string }
  | { type: "meeting_start"; title: string; topic: string; attendees: AgentId[] }
  | { type: "meeting_say"; agentId: AgentId; text: string }
  | { type: "meeting_end"; title: string }
  | { type: "customer_line"; from: AgentId | "you"; to: AgentId | "you"; text: string; time: string }
  | { type: "ask_human"; agentId: AgentId; question: string; requestId: string }
  | { type: "move_to"; agentId: AgentId; zone: ZoneId }
  | { type: "task_update"; task: Ticket }
  | { type: "tasks_replaced"; tasks: Ticket[] }
  | { type: "queue_update"; agentId: AgentId; queue: Ticket[] }
  | { type: "status"; agentId: AgentId; status: string }
  | { type: "books"; balance: number; todayEarnings: number; todayTokens: number }
  | { type: "stock"; items: StockSku[] }
  | {
      type: "sale";
      skuId: string;
      label: string;
      qty: number;
      unit: string;
      revenue: number;
      salesperson: AgentId;
    }
  | { type: "reorder_alert"; skuId: string; label: string; qty: number; reorderAt: number; unit: string }
  | { type: "reordered"; skuId: string; label: string; qty: number; unit: string; cost: number }
  | { type: "bell" }
  | { type: "phone"; kind: "ring" | "pickup" | "transfer" | "hangup" }
  | { type: "fire"; zone: ZoneId; on: boolean }
  | { type: "goal_met" }
  | { type: "tick"; n: number; time: string }
  | { type: "error"; message: string }
  | {
      type: "guardrail";
      channel: "customer" | "hq" | "goal";
      reason: "too_long" | "too_expensive" | "off_limits" | "off_topic";
      reply: string;
      agentId?: AgentId;
    };

export type ClientMessage =
  | { type: "start"; goal: string; provider: Provider; model: string; speed: SimSpeed }
  | { type: "human_reply"; agentId: AgentId; requestId: string; text: string }
  | { type: "customer_say"; to: AgentId; text: string }
  | { type: "dial"; to: AgentId }
  | { type: "hangup" }
  | { type: "set_speed"; speed: SimSpeed };

export const SPEED_MS: Record<SimSpeed, number> = {
  slow: 5000,
  normal: 2200,
  fast: 1100,
};

export const TICK_MINUTES = 1;
export const DAY_START = 9 * 60;
export const DAY_END = 17 * 60;

export const DEFAULT_GOAL = "Close a paper sale with customer calling on the phone.";

export interface CompanyGoal {
  id: string;
  label: string;
  text: string;
  /** Daily sales target. Null = first close wins. */
  targetUsd: number | null;
}

export const COMPANY_GOALS: CompanyGoal[] = [
  {
    id: "close-one",
    label: "Close one phone sale",
    text: DEFAULT_GOAL,
    targetUsd: null,
  },
  {
    id: "make-250",
    label: "Make $250 today",
    text: "Make $250 today from paper sales.",
    targetUsd: 250,
  },
  {
    id: "make-1000",
    label: "Make $1000 today",
    text: "Make $1000 today from paper sales.",
    targetUsd: 1000,
  },
  {
    id: "make-2000",
    label: "Make $2000 today",
    text: "Make $2000 today from paper sales.",
    targetUsd: 2000,
  },
  {
    id: "ring-bell",
    label: "Ring the $100 sales bell",
    text: "Land $100+ in paper sales today and ring the bell.",
    targetUsd: 100,
  },
  {
    id: "list-price",
    label: "Hold the price sheet",
    text: "Hold the price sheet and close a paper sale at list price.",
    targetUsd: null,
  },
];

export function parseGoalTargetUsd(goal: string): number | null {
  const preset = COMPANY_GOALS.find((g) => g.text === goal);
  if (preset) return preset.targetUsd;
  const hit = goal.match(/\$\s*(\d{1,3}(?:,\d{3})*|\d+)/);
  if (!hit?.[1]) return null;
  return Number(hit[1].replaceAll(",", ""));
}

export function goalReached(goal: string, todayEarnings: number): boolean {
  const target = parseGoalTargetUsd(goal);
  if (target == null || target <= 0) return todayEarnings > 0;
  return todayEarnings >= target;
}
