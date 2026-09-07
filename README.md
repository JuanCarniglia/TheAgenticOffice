# The Agentic Office

A vintage PC game of a paper company run by AI agents. Five workers live on an isometric floorplan. You sit in the lobby as the customer. Jim or Dwight pitch you paper; Michael, Angela, and Pam keep the office moving.

Two processes, one TypeScript repo: a Phaser 3 game in the browser, and a local harness that ticks the office, runs tools, and (optionally) calls an LLM.

## Docs

| Document | What it covers |
| --- | --- |
| [Engineering Spec](docs/ENGINEERING_SPEC.md) | Requirements, architecture, constraints, acceptance criteria, major decisions |
| [Agentic System Map](docs/AGENTIC_SYSTEM_MAP.md) | Context, agents, tools, workstreams, orchestration |
| [Parallelization Evidence](docs/PARALLELIZATION.md) | Which workstreams run in parallel (product and build) |
| [Harness / Evaluation](docs/HARNESS_EVALUATION.md) | Tests, evals, review loops, traces, budgets |
| [Autonomous Loop Evidence](docs/AUTONOMOUS_LOOP.md) | Detect → react → continue without a new human instruction |
| [AI Development Log](docs/AI_DEVELOPMENT_LOG.md) | Workflow, iterations, failures, corrections, human decisions |

## Setup

Requires **Node.js 20+** (developed on Node 26) and npm.

```bash
git clone <this-repo>
cd TheAgenticOffice
npm install
cp .env.example .env
```

Mock mode needs no keys. Live agents need at least one of the keys below.

## Environment variables

Copy `.env.example` to `.env` in the **repo root**. Keys stay on the harness — they are never bundled into the browser.

| Variable | Required when | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Settings → OpenAI | LangChain `ChatOpenAI` for novel customer replies |
| `ANTHROPIC_API_KEY` | Settings → Anthropic | LangChain `ChatAnthropic` for novel customer replies |
| `CURSOR_API_KEY` | Settings → Cursor | Cursor SDK agent (`composer-2.5` by default). Create a key in Cursor Dashboard → Integrations |
| `PORT` | optional | Harness HTTP/WebSocket port. Default `8787` |
| `HOST` | optional | Bind address. Default `127.0.0.1`. ECS/Docker sets `0.0.0.0` |

Do not commit `.env`. `.gitignore` already excludes it.

## Run

```bash
npm run dev
```

That starts **two processes in parallel** (`concurrently`):

| Process | URL | What it is |
| --- | --- | --- |
| `game` (Vite) | http://127.0.0.1:5178/ | Phaser UI, intro, settings, office |
| `harness` (tsx) | http://127.0.0.1:8787 | Clock, agents, tools, WebSocket `/ws` |

Open the game URL. Click through the intro, pick a company goal and provider, then **Open Office**.

Individual processes:

```bash
npm run dev:game      # Vite only
npm run dev:harness   # harness only
```

Vite proxies `/ws`, `/health`, and `/session` to the harness. If the harness is down, the HUD shows `OFFICE NETWORK: WAITING FOR HARNESS…`.

## Other scripts

```bash
npm run eval        # offline guardrail / commerce / goal eval (no API keys)
npm run typecheck   # tsc --noEmit
npm run build       # typecheck + Vite production bundle
```

## Dependencies (high level)

| Layer | Libraries |
| --- | --- |
| Game | `phaser`, Vite |
| Harness HTTP | `hono`, `@hono/node-server`, `ws` |
| Live agents | `@langchain/langgraph`, `@langchain/openai`, `@langchain/anthropic`, `@cursor/sdk` |
| Shared | `zod`, `dotenv` |
| Dev | `typescript`, `tsx`, `concurrently` |

## External services

None are required to play.

| Provider | When used | Notes |
| --- | --- | --- |
| None (Mock) | Default | Scripted ticks, straw draw, sales lines, floor bits |
| OpenAI | Settings → OpenAI | Default model `gpt-4o-mini`. Network call per **novel** customer reply |
| Anthropic | Settings → Anthropic | Default model `claude-sonnet-4-0` |
| Cursor | Settings → Cursor | Local Cursor agent in a sandboxed temp directory; office tools only (no shell/files/web) |

Fonts load from Google Fonts (`Press Start 2P`, `VT323`). The game still boots if that request fails.

## Play loop

1. Company goal (close one sale, make $250 / $1000 / $2000, ring the $100 bell, hold list price, or a short custom goal).
2. Morning: Jim and Dwight draw straws. The short straw opens customer chat from the desk.
3. You type one short line (paper, qty, yes/no). Off-topic, commands, URLs, and token dumps are refused.
4. A yes rings up warehouse stock and cash. Low stock sends Angela to Pam; a mill truck restocks later at 20% of list.
5. The floor keeps running: standup, fires Dwight puts out, faxes, coffee, Michael yelling WHAZUUUP.

## Ports

| Port | Bound to | Owner |
| --- | --- | --- |
| `5178` | `127.0.0.1` | Vite (chosen because `5173` was already taken on this machine) |
| `8787` | `HOST` (default `127.0.0.1`) | Harness. After `npm run build`, also serves the game |

Local `npm run dev` still uses two processes. Production (Docker/ECS) is one process on `8787`.

## AWS (ECS)

The office is **not** an S3 static site. Terraform under [`devops/`](devops/README.md) deploys one Fargate task behind an ALB (game + WebSocket together).

```bash
cp devops/terraform/terraform.tfvars.example devops/terraform/terraform.tfvars
./devops/scripts/deploy.sh
```

