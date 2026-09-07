import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentId, MemoryFact, MemoryKind } from "../shared/types.js";

const SHORT_LIMIT = 8;
const DATA_FILE = join(dirname(fileURLToPath(import.meta.url)), "../../data/memory.json");

export type ShortTerm = Record<AgentId, MemoryFact[]>;

export function emptyShortTerm(): ShortTerm {
  return {
    michael: [],
    pam: [],
    jim: [],
    dwight: [],
    angela: [],
  };
}

export function rememberShort(
  store: ShortTerm,
  agentId: AgentId,
  text: string,
  time: string,
  kind: MemoryKind = "interaction",
): MemoryFact {
  const fact: MemoryFact = {
    id: crypto.randomUUID(),
    agentId,
    kind,
    text,
    time,
  };
  const next = [...store[agentId], fact];
  store[agentId] = next.slice(-SHORT_LIMIT);
  return fact;
}

export function formatShortTerm(store: ShortTerm, agentId: AgentId): string {
  const notes = store[agentId];
  if (!notes.length) return "(empty)";
  return notes.map((n) => `- [${n.time}] ${n.kind}: ${n.text}`).join("\n");
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

function score(query: string, fact: MemoryFact): number {
  const q = new Set(tokenize(query));
  const words = tokenize(fact.text);
  if (!q.size || !words.length) return 0;
  let hits = 0;
  for (const w of words) if (q.has(w)) hits += 1;
  const kindBoost = fact.kind === "decision" ? 0.4 : fact.kind === "requirement" ? 0.3 : 0;
  return hits / Math.sqrt(words.length) + kindBoost;
}

/** File-backed long-term memory. Keyword retrieval now; embeddings can slot in later. */
export class LongTermMemory {
  private facts: MemoryFact[] = [];
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(DATA_FILE, "utf8");
      this.facts = JSON.parse(raw) as MemoryFact[];
    } catch {
      this.facts = [];
    }
    this.loaded = true;
  }

  async remember(fact: Omit<MemoryFact, "id"> & { id?: string }): Promise<MemoryFact> {
    await this.load();
    const full: MemoryFact = { ...fact, id: fact.id ?? crypto.randomUUID() };
    this.facts.push(full);
    await this.persist();
    return full;
  }

  async recall(agentId: AgentId, query: string, k = 3): Promise<MemoryFact[]> {
    await this.load();
    const pool = this.facts.filter(
      (f) => f.agentId === agentId || f.kind === "gossip" || f.kind === "requirement",
    );
    return pool
      .map((f) => ({ f, s: score(query, f) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map((x) => x.f);
  }

  formatRecall(facts: MemoryFact[]): string {
    if (!facts.length) return "(nothing recalled)";
    return facts.map((f) => `- [${f.time}] (${f.kind}, ${f.agentId}) ${f.text}`).join("\n");
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(DATA_FILE), { recursive: true });
    await writeFile(DATA_FILE, JSON.stringify(this.facts, null, 2), "utf8");
  }
}

export function emptyQueues(): Record<AgentId, import("../shared/types.js").Ticket[]> {
  return { michael: [], pam: [], jim: [], dwight: [], angela: [] };
}
