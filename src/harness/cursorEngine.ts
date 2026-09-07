import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, CursorAgentError, type SDKCustomTool, type SDKJsonValue, type ToolName } from "@cursor/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import { workerById } from "../shared/roster.js";
import type { AgentId, OfficeEvent } from "../shared/types.js";
import { estimateTokens } from "../shared/catalog.js";
import { PHONE_CHAT_RULES } from "../shared/guardrails.js";
import {
  defaultBoard,
  emitBooks,
  formatSlimBoard,
  recordTokens,
  seedQueues,
  sessionStartedEvent,
  type OfficeState,
} from "./officeState.js";
import { createOfficeTools } from "./tools.js";
import { LongTermMemory } from "./memory.js";
import { officeLog } from "../shared/trace.js";
import { rememberSalesReply } from "./salesScript.js";

const SCRATCH = join(tmpdir(), "the-agentic-office-cursor");
const OFFICE_ONLY_TOOLS: ToolName[] = ["mcp"];
const BLOCKED_TOOLS: ToolName[] = [
  "shell",
  "read",
  "edit",
  "grep",
  "glob",
  "ls",
  "task",
  "webSearch",
  "webFetch",
  "delete",
  "semSearch",
  "generateImage",
  "applyAgentDiff",
  "readLints",
  "updateTodos",
  "readTodos",
  "askQuestion",
  "await",
];
export const DEFAULT_CURSOR_MODEL = "composer-2.5";

type CursorAgent = Awaited<ReturnType<typeof Agent.create>>;

export interface CursorHandle {
  tick: () => Promise<void>;
  close: () => Promise<void>;
}

function jsonSchema(schema: z.ZodType): Record<string, SDKJsonValue> {
  const raw = zodToJsonSchema(schema, { $refStrategy: "none" }) as Record<string, unknown>;
  delete raw.$schema;
  return raw as Record<string, SDKJsonValue>;
}

function salesTools(
  state: OfficeState,
  emit: (e: OfficeEvent) => void,
  memory: LongTermMemory,
  agentId: AgentId,
) {
  const customTools: Record<string, SDKCustomTool> = {};
  const worker = workerById(agentId);
  const tools = createOfficeTools({ state, emit, agentId, memory }).filter(
    (t) => t.name === "pitch_customer",
  );
  for (const t of tools) {
    const name = `${agentId}_${t.name}`;
    const invoke = t.invoke.bind(t) as (args: Record<string, unknown>) => Promise<unknown>;
    customTools[name] = {
      description: `${worker.name}: ${t.description}`,
      inputSchema: jsonSchema(t.schema as z.ZodType),
      async execute(args) {
        officeLog("cursor-tool", name, args);
        const result = await invoke(args);
        officeLog("cursor-tool", name, "→", result);
        if (typeof result === "string") return result;
        return JSON.stringify(result ?? "");
      },
    };
  }
  return customTools;
}

function salesReplyPrompt(state: OfficeState): string {
  const to = state.lastCustomerTo ?? "jim";
  const name = workerById(to).name;
  return [
    `You are ${name} at a paper company, on a phone call.`,
    `Call ${to}_pitch_customer once with a NEW line under 180 characters.`,
    PHONE_CHAT_RULES,
    formatSlimBoard(state),
  ].join("\n\n");
}

export async function startCursorSession(
  state: OfficeState,
  emit: (e: OfficeEvent) => void,
  memory: LongTermMemory,
): Promise<CursorHandle> {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("CURSOR_API_KEY is missing in the harness .env (Dashboard → Integrations)");
  }

  mkdirSync(SCRATCH, { recursive: true });
  state.tasks = defaultBoard();
  seedQueues(state);
  emit(sessionStartedEvent(state));
  emitBooks(state, emit);
  emit({ type: "stock", items: state.stock.map((s) => ({ ...s })) });

  const modelId = state.model.trim() || DEFAULT_CURSOR_MODEL;
  let agent: CursorAgent | null = null;

  const dispose = async () => {
    if (!agent) return;
    const current = agent;
    agent = null;
    try {
      await current[Symbol.asyncDispose]();
    } catch {
      current.close();
    }
  };

  return {
    async tick() {
      const to = state.lastCustomerTo;
      const asked = state.lastCustomerText;
      if (!to || !asked) return;
      const customTools = salesTools(state, emit, memory, to);
      const prompt = salesReplyPrompt(state);
      officeLog("cursor", "sales-reply", to);
      try {
        await dispose();
        agent = await Agent.create({
          apiKey,
          model: { id: modelId },
          tools: OFFICE_ONLY_TOOLS,
          disallowedTools: BLOCKED_TOOLS,
          name: "The Agentic Office",
          local: {
            cwd: SCRATCH,
            settingSources: [],
            sandboxOptions: { enabled: true },
            customTools,
          },
        });
        const run = await agent.send(prompt, { local: { customTools } });
        const result = await run.wait();
        const reply = state.pendingCustomer?.question ?? "";
        if (reply) rememberSalesReply(to, asked, reply);
        state.lastCustomerText = "";
        state.lastCustomerTo = null;
        const billed = result.usage?.totalTokens ?? 0;
        const tokens = billed || estimateTokens(prompt, result.result ?? "");
        recordTokens(state, tokens, emit);
        if (result.status === "error") {
          emit({
            type: "error",
            message: `Cursor run failed (${result.id})${result.error?.message ? `: ${result.error.message}` : ""}`,
          });
        }
      } catch (err) {
        if (err instanceof CursorAgentError) {
          emit({ type: "error", message: `Cursor: ${err.message}` });
          return;
        }
        throw err;
      } finally {
        await dispose();
      }
    },
    close: dispose,
  };
}
