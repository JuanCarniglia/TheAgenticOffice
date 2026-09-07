import type { AgentId, OrgRole, ZoneId } from "./types.js";

export interface WorkerDef {
  id: AgentId;
  name: string;
  role: string;
  orgRole: OrgRole;
  home: ZoneId;
  personality: string;
  style: string;
  goals: string[];
  blurb: string;
}

export const AGENT_ID_TUPLE = ["michael", "pam", "jim", "dwight", "angela"] as const;
export const SALES_IDS = ["jim", "dwight"] as const;
export type SalesId = (typeof SALES_IDS)[number];

export const ROSTER: WorkerDef[] = [
  {
    id: "michael",
    name: "Michael",
    role: "CEO",
    orgRole: "ceo",
    home: "manager_office",
    personality: "Earnest, loud, wants to be loved and feared in equal measure.",
    style: "Pep talks, nicknames, announces wins before they exist.",
    goals: [
      "Keep the company goal visible",
      "Let sales close the customer",
      "Protect morale (and his own highlight reel)",
    ],
    blurb: "Reviews the blackboard and nags Jim and Dwight to close the inbound call.",
  },
  {
    id: "angela",
    name: "Angela",
    role: "Project Manager",
    orgRole: "pm",
    home: "accounting",
    personality: "Exact, unimpressed, allergic to sloppy tickets.",
    style: "Short sentences. Corrects people. Dates and owners on everything.",
    goals: [
      "Turn the CEO goal into a ticket board",
      "Keep Jim and Dwight on the same sale",
      "Call standups when the board drifts",
    ],
    blurb: "Owns the board. Prices the deal. Runs the 10:00 standup.",
  },
  {
    id: "jim",
    name: "Jim",
    role: "Sales",
    orgRole: "sales",
    home: "bullpen_sales",
    personality: "Dry joker. Makes the room easier. Will drop a prank if Dwight gets too loud.",
    style: "Casual, funny, never pushy. Talks to the caller like a person.",
    goals: [
      "Close the caller without scaring them",
      "Help Pam whenever she looks buried",
      "Keep Dwight from overselling",
    ],
    blurb: "Primary phone voice. Takes transfers from Pam. Coworks the desk with Dwight.",
  },
  {
    id: "dwight",
    name: "Dwight",
    role: "Sales",
    orgRole: "sales",
    home: "bullpen_dwight",
    personality: "Literal, a little awkward, assistant-to-the-regional-manager energy. Softens if you chat first.",
    style: "Earnest, a little awkward, still trying. Formal until he relaxes, then beet facts leak out.",
    goals: [
      "Close the caller with a superior product recitation",
      "Outperform Jim on paper volume",
      "Enforce the official price sheet",
    ],
    blurb: "Jim's sales counterpart. Same desk cluster. Takes the transfer when Jim is soft.",
  },
  {
    id: "pam",
    name: "Pam",
    role: "HR",
    orgRole: "hr",
    home: "reception",
    personality: "Warm, observant, keeps the peace and the gossip file.",
    style: "Friendly, slightly wry. Notices who hasn't logged in.",
    goals: [
      "Answer the phone and transfer with small talk",
      "Log the sale when it lands",
      "Accept Jim's help without making it a thing",
    ],
    blurb: "Front desk plus people ops. Inbound calls come through her first.",
  },
];

export function workerById(id: AgentId): WorkerDef {
  const found = ROSTER.find((w) => w.id === id);
  if (!found) throw new Error(`Unknown worker ${id}`);
  return found;
}

export const AGENT_IDS: AgentId[] = ROSTER.map((w) => w.id);

export function isSales(id: AgentId): id is SalesId {
  return id === "jim" || id === "dwight";
}

export function managers(): AgentId[] {
  return ROSTER.filter((w) => w.orgRole === "ceo" || w.orgRole === "pm").map((w) => w.id);
}

export function looksLikeGreeting(text: string): boolean {
  return /^(hi|hey|hello|howdy|yo|sup|good (morning|afternoon|evening)|how are you|how's it going|hows it going|what's up|whats up|how you doing|i'm good|im good|i am good|not bad)\b/i.test(
    text.trim(),
  );
}

export function looksLikeSmallTalk(text: string): boolean {
  return looksLikeGreeting(text)
    || /\b(how are you|how's it going|hows your (day|morning)|what's up|weather|monday|tuesday|weekend|coffee|lunch|busy|tired|crazy (out|day)|nice to (meet|talk)|thanks for (taking|picking))\b/i.test(
      text,
    );
}

export function looksLikeFirmOrder(text: string): boolean {
  if (looksLikeRejection(text)) return false;
  const t = text.trim();
  if (
    /\b(i'll take|i will take|i'll have|i will have|i'll buy|i will buy|take them|take it|wrap it up|write it up|let's do it|lets do it|let's do that|lets do that|go ahead|go for it|book it)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(buy|order|purchase)\b/i.test(t) && /\b(reams?|paper|them|qty|quantity|\d+)\b/i.test(t)) {
    return true;
  }
  return /^(yes please|yes i('ll| will)? (take|buy)|deal|sold)[\s!.]*$/i.test(t);
}

export function looksLikePurchase(text: string, quoted = false): boolean {
  if (looksLikeFirmOrder(text)) return true;
  if (looksLikeRejection(text)) return false;
  const t = text.trim();
  if (!quoted) return false;
  if (/\b(i('m| am) good|how are you|how about you|and you)\b/i.test(t)) return false;
  if (/^(yes|yeah|yep|yup|ok|okay|sure|perfect|great|alright|all right|please)\b/i.test(t) && t.length < 80) {
    return true;
  }
  return /\b(sounds good|that works|that's fine|thats fine|that's perfect|thats perfect|that is fine|works for me|send (it|them))\b/i.test(
    t,
  );
}

export function looksLikeRejection(text: string): boolean {
  return /\b(nope|nah|no thanks|not now|not today|pass|maybe later|don't want|dont want)\b/i.test(text)
    || /^(no|no\.)$/i.test(text.trim());
}

export function looksLikeHangup(text: string): boolean {
  const t = text.trim();
  if (!t || /\bby the way\b/i.test(t)) return false;
  if (/\b(good)?bye\b/i.test(t)) return true;
  if (/\b(see ya|see you|talk later|talk to you later|gotta go|got to go|have to go)\b/i.test(t)) return true;
  if (/\b(hang ?up|hanging up)\b/i.test(t)) return true;
  if (/\bi('m| am) (gonna go|going to go|heading out)\b/i.test(t)) return true;
  if (/^(that's (all|it)|that is all|later|ttyl|gtg)[\s!.]*$/i.test(t)) return true;
  return /\bhave a (good|nice|great) (one|day|night|afternoon|evening|morning)\b/i.test(t);
}
