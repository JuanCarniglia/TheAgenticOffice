# The Agentic Office

A vintage PC game of a paper company run by AI agents. Five workers live on an isometric floorplan. You are the **inbound caller**. Pam picks up, chats, and transfers you to Jim or Dwight; Michael and Angela keep the office moving.

Two processes, one TypeScript repo: a Phaser 3 game in the browser, and a local harness that ticks the office, runs tools, and (optionally) calls an LLM. After `npm run build`, the harness can serve the game itself (Docker / ECS).

## About

The goal of the game is to demonstrate an AGENTIC Office (An office run by AI Agents, instead of real people), doing a real life purpose, like selling paper.

In the game, you start by selecting the “end goal”. It can be to make a sale, to sell $ 1000, to empty stock, etc. 

You (human) play the customer, you can buy paper, chat with Jim or Dwight, or you can just watch the fun action on the office floor.

## Pam

Pam has the role of the Secretary. She gets to answer the phone when a customer (you) calls in, and forwards the call to either Jim or Dwight (Depending who you wanted to talk to).

Also, she seldoms receives a Fax from Corporate, and sends it over to Michael, who in turns asks her to file it on the “special cabinet” (trash).

She also hits the bell, every time a sale of over $ 100 is made.

She contacts the repositioning team (depot), to get re-stocked.

## Michael

Michael is the Manager. He has no real job there, only to congratulate Jim or Dwight when they make a sale, ask every now and then if there are any more sales and call for an all-hands, gathering all other agents.

He also does the Wazuuuuup bit, trying to get Jim and Dwight to tag along.

## Angela

Angela has a side-role, but important. She is responsible for keeping the stock at level. So whenever a certain item hits reposition level, she goes to Pam and asks her to re-stock that item. She keeps the stock books, sort of.

She sometimes thinks about her cats.

## Jim

Jim is the leading salesman (or is he?) and he tries to sell you stuff. If you let him, he will try to sell the top product on the stock list. You need to tell him specifically what product you want, and how many reams (paper). He cannot sell you more than what is on stock, so don’t insist.
He is polite, chatty and fun to talk to, but he is clearly bored of his job.

Also, he and Pam sometimes scuttle over to the cafeteria for (...) some time alone to chat.


## Dwight

He is also a sales man (and assistant regional manager, or assistant to the regional manager, whatever). He tries to get sales over Jim, and he is correct but cold in his demeanor. He will also need specific instructions to make a sale.

Every now and then, a small fire will break out in the office and you will see him running over to control it (he is also a volunteer sheriff deputy, so it makes sense).



Neither Jim or Dwight can talk about anything else than selling paper, they are quite constrained by corporate.

To play the game, you need to start by calling either Jim or Dwight using the chat window. Remember to end the call, in order to actually make the buy.

## Spending

There is also a “Company Books” window, where you can see how much money was gained on the current game, and also how much you spent on tokens (That is real money, by the way!)

At any time you can see what each Agent is doing, by clicking on them. You will get a notion of the last action performed and what they are currently waiting on.

Since the office actions actually spend tokens, the office “Locks Down” after a few minutes of inactivity.



## Docs

Full DOCS : https://docs.google.com/document/d/15fNYfR1WMIpYJ0xbnZOVevpybDLFTfL_g-N6daD8bhQ/edit?usp=sharing

| Document | What it covers |
| --- | --- |
| [Engineering Spec](docs/ENGINEERING_SPEC.md) | Requirements, architecture, constraints, acceptance criteria, major decisions |
| [Agentic System Map](docs/AGENTIC_SYSTEM_MAP.md) | Context, agents, tools, workstreams, orchestration |
| [Parallelization Evidence](docs/PARALLELIZATION.md) | Which workstreams run in parallel (product and build) |
| [Harness / Evaluation](docs/HARNESS_EVALUATION.md) | Tests, evals, review loops, traces, budgets |
| [Autonomous Loop Evidence](docs/AUTONOMOUS_LOOP.md) | Detect → react → continue without a new human instruction |
| [AI Development Log](docs/AI_DEVELOPMENT_LOG.md) | Workflow, iterations, failures, corrections, human decisions |
| [AWS ECS deploy](devops/README.md) | One Fargate task: game + WebSocket behind an ALB |

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
| `PROVIDER` | optional | Lock Settings → Provider (`mock`, `openai`, `anthropic`, `cursor`). Field is disabled. ECS: `office_provider`. |
| `MODEL` | optional | Lock Settings → Model (any model id). Field is disabled. ECS: `office_model`. |
| `FLOOR` | optional | Lock Settings → Floor intelligence (`scripted` or `live`). Field is disabled. ECS: `office_floor`. Mock still runs Scripted. |

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

Open the game URL. Click through the intro, pick a company goal, provider, floor intelligence (Scripted vs Live office), and sound, then **Open Office**. Dial Jim or Dwight — the phone rings at Pam’s desk first. Mock is always Scripted. Live office (OpenAI / Anthropic / Cursor) spends tokens only on sales, standup, stall, and reorder. Three minutes without chat locks the office and returns to the title so an empty session does not keep spending.

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
npm start           # harness only; serves dist/ when index.html exists
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
| None (Mock) | Default | Scripted ticks, inbound-call beats, canned sales lines, floor bits |
| OpenAI | Settings → OpenAI | Default model `gpt-4o-mini`. Network call per **novel** customer reply |
| Anthropic | Settings → Anthropic | Default model `claude-sonnet-4-0` |
| Cursor | Settings → Cursor | Local Cursor agent in a temp directory; office tools only (no shell/files/web). OS sandbox is off — this environment does not support it. |

Fonts load from Google Fonts (`Press Start 2P`, `VT323`). The game still boots if that request fails.

## Play loop

1. Company goal (close one phone sale, make $250 / $1000 / $2000, ring the $100 bell, hold list price, or a short custom goal).
2. Dial **Jim** or **Dwight** (or type — idle lines start the same inbound call). The phone rings at Pam’s desk.
3. Pam greets you. Small talk is fine. She transfers to whoever you asked for.
4. Chat first; a quote comes when you ask. **Yes / ok / sounds good** only rings up **after** a quote. A spec change (“recycled, legal, 35”) updates the ticket instead of closing the old one.
5. **HANG UP** or type bye. Low stock sends Angela to Pam; a mill truck restocks later at 20% of list.
6. The floor keeps running: standup, fires Dwight puts out, faxes, coffee, Michael yelling WHAZUUUP.
7. Sit idle for **three minutes** (no chat, dial, hangup, or HQ reply) and the office stamps **OFFICE LOCKED DOWN**, then the title. The harness clock stops.

Settings **Sound** (Web Audio) plays ring / pickup / transfer / hangup, the $100 bell, and UI beeps. The title theme (`public/assets/theme.mp3`) loops on Intro and Settings and stops when the office opens. Typewriter timing is on chat lines and floor balloons.

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

