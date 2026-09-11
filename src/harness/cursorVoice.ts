import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, type ToolName } from "@cursor/sdk";
import { estimateTokens } from "../shared/catalog.js";

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

/** One spoken line. No office tools — used by directed floor/phone voice. */
export async function performCursorVoice(model: string, prompt: string): Promise<{ text: string; tokens: number }> {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) throw new Error("CURSOR_API_KEY is missing");
  mkdirSync(SCRATCH, { recursive: true });
  const agent = await Agent.create({
    apiKey,
    model: { id: model.trim() || "composer-2.5" },
    tools: OFFICE_ONLY_TOOLS,
    disallowedTools: BLOCKED_TOOLS,
    name: "The Agentic Office",
    local: {
      cwd: SCRATCH,
      settingSources: [],
      sandboxOptions: { enabled: false },
    },
  });
  try {
    const run = await agent.send(prompt);
    const result = await run.wait();
    const text = result.result?.trim() ?? "";
    const tokens = result.usage?.totalTokens ?? estimateTokens(prompt, text);
    if (result.status === "error") {
      throw new Error(result.error?.message || "Cursor voice run failed");
    }
    return { text, tokens };
  } finally {
    try {
      await agent[Symbol.asyncDispose]();
    } catch {
      agent.close();
    }
  }
}
