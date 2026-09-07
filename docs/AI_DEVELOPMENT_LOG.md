# AI Development Log

Greenfield, 6–7 Sep 2026. One human operator, Cursor agents in-repo. No git commits yet; this log is reconstructed from the implementation chat and the current tree.

## How the work was run

1. **Plan first.** Human pasted a floorplan image and asked for options (game runtime + agent orchestration), then a v1 plan.
2. **Human locked two forks:** Phaser in the browser; LangGraph-style harness with **their** OpenAI/Anthropic keys (not “Cursor SDK only”, not Ollama-only).
3. **Implement the plan todos in one agent pass:** Vite/Phaser → floorplan overlay → mock harness → LangGraph tools → browser verify.
4. **Tight review loops:** human playtests → notes → agent patch → preview again.
5. **Corrections are first-class.** Token burn, stock not moving, stamp too early, Cursor-as-provider, guardrails — each was a detect/fix without rewriting the event protocol.

## Timeline

### 2026-09-06 ~20:27 — Intent

Human: a real AI office, vintage PC game, birds-eye *The Office*-like floor, balloons for questions, agents coordinated to a common goal. Plan, then build.

Agent: empty repo; proposed Phaser vs Godot vs Electron, and Cursor SDK vs LangGraph vs Ollama vs mock-first.

**Human decision:** Phaser + LangGraph + own keys.

### 2026-09-06 ~20:30 — v1 plan (approved)

Architecture still visible in the tree:

- Two processes, shared `OfficeEvent`
- Mock first-class
- Supervisor-facing Michael, Pam reception, Jim bullpen, Angela accounting
- Tools: say, ask_human, talk_to, update_task, move_to
- Win: tasks done / goal met, “QUARTERLY REVIEW” stamp

**Human decision:** implement as specified; do not edit the plan file.

### 2026-09-06 ~20:32–20:40 — First playable

Scaffold, floorplan copy, four workers, harness on `8787`. **Failure:** preview hit the wrong Vite (IPv4 `:5173` already taken; our Vite bound IPv6). **Correction:** move game to **5178**, proxy WS there. Intro → settings → overlay → Jim HQ balloon verified.

### 2026-09-06 ~21:12 — Company OS

Human asked for personas + memory, watercooler/DMs/meetings, a slower office clock, shared blackboard.

**Shipped:** org roles, 15-minute-style clock (later 1-minute), Jira board, personal queues, file memory, standup at 10:00. Browser check: login, cooler, standup, desks, board updates.

Jim was still framed as “developer” in copy; sales-customer play was not the loop yet.

### 2026-09-07 ~10:58 — You are the customer

Human notes:

- Add **Dwight**, cowork with Jim (strict vs joker); Jim orbits Pam
- Clock too fast; play as customer in a **typed chat**
- Pan/zoom broken; balloons overflow; fonts muddy

**Shipped:** fifth agent, customer chat, slower tick, balloon wrap, camera drag/wheel. Only Jim/Dwight may `pitch_customer`.

### 2026-09-07 ~11:15 — Office starts itself; commerce

Human: chat too big / not movable; scene should start from Jim or Dwight (coin/straws); stock + cash; a simple office menu (Windows 3.1).

**Shipped:** draggable minimizable chat; straw draw; `stock_definitions.md` catalog; BOOKS/STOCK/WHO’S UP; `ring_up`. Sale loop verified in mock (browser click-through of the sale was not available in that Cursor browser session; mock path was).

### 2026-09-07 ~11:43 — Cursor as a provider

Human: add Cursor.

**Failure:** Cursor has **no** raw chat-completions API. First instinct (LangChain OpenAI-compatible base URL) was wrong.

**Correction:** `@cursor/sdk` `Agent.create`, custom office tools, temp sandbox cwd, `disallowedTools` for shell/files/web. Settings fourth provider. `CURSOR_API_KEY` in harness `.env`.

### 2026-09-07 ~12:07 — Guardrails

Human: business context only; no commands or websites; skip token-heavy asks; short human sentences or ask to shorten.

**Shipped:** `guardrails.ts` on customer, HQ, and goal; UI maxlength + harness re-screen; in-character refusals. Prompt rules copied into live agents.

### 2026-09-07 ~12:17 — Stamp bug

Human: quarterly review sign too soon, then stuck.

**Cause:** first “yes”/even a loose “ok” set `goal_met`; stamp never faded.

**Correction:** win waits for Michael’s congratulations beat; stamp is a short celebrate.

### 2026-09-07 ~12:31 — Floor discipline

Human: no ESC exit; MENU; sprites overlap; Jim/Dwight wander to lobby; dual slowness (tick delay + live model).

**Shipped:** MENU button; unique stand-slots; `recallWanderers`; Pam slot left of desk; faster `SPEED_MS`.

### 2026-09-07 ~12:44 — Ambient autonomy

Human: fire (Dwight), fax (Pam→Michael trash), Angela cats, silent Jim/Pam coffee, Dwight “Boom Bam Boom”.

**Shipped:** weighted ambient beats; fire sprite; do not recall wanderers mid-scene.

### 2026-09-07 ~13:02 — Reorder economics + rarity

Human: Angela asks Pam to reorder; mill cost 20% of sale price; restock to original qty; Whazup/fax too frequent; balloons; zoom too fast.

**Shipped:** `queueReorderAsk`, `REORDER_COST_RATE = 0.2`, cooldowns, balloon wrap vs string width, gentler wheel zoom.

### 2026-09-07 ~13:13 — Token emergency

Human: staggering token spend; space random actions; cache prompts/responses.

**Cause (agent diagnosis):** not the floor bits. Live model on **every clock tick** with full blackboard (20 SKUs, queues, DMs, personas, tool schemas); Cursor/LangGraph stacking old turns.

**Correction:**

- LLM **only** for a novel customer reply
- Standup, straws, opening pitch, thanks, ambient = scripted
- `cannedSalesReply` + `rememberSalesReply`
- `formatSlimBoard`
- Unique thread ids; Cursor agent disposed each turn
- Day cap 500k tokens

This is the largest architectural correction after v1: **supervisor-every-tick → clock + beats + on-demand sales agent**.

### 2026-09-07 ~13:16 — Goal picker

Human: more company goals (e.g. make $1000).

**Shipped:** `COMPANY_GOALS` dropdown; `parseGoalTargetUsd` / `goalReached`.

### 2026-09-07 ~13:57 — Stock “didn’t drop”

Human: bought items, stock unchanged.

**Cause:** 30-ream A3 sale 40→10 **did** land, then reorder immediately filled to 40.

**Correction:** 36-tick mill delay; incoming qty shown; cage stays short until Pam’s truck.

### 2026-09-07 ~14:08 — Docs + eval

Human: engineering spec, system map, parallelization, harness, autonomous loops, development log, README.

**Shipped:** this `docs/` set, root README, `npm run eval` (22 offline cases).

## Human decisions (index)

| Decision | Owner |
| --- | --- |
| Phaser browser, not Godot/Electron | Human |
| Own API keys + LangGraph-style harness, not Ollama-only | Human |
| Mock must work without keys | Plan (human-approved) |
| Player is the customer | Human |
| Fifth worker Dwight | Human |
| Cursor as a provider | Human |
| Fail-closed business guardrails | Human |
| MENU not ESC | Human |
| Ambient comedy bits | Human |
| Reorder via Angela→Pam at 20% cost | Human |
| Cut token spend hard | Human |
| Extra dollar goals | Human |

## Agent decisions (index)

| Decision | Owner |
| --- | --- |
| Shared event bus; game never holds keys | Agent (plan) |
| Port 5178 after 5173 collision | Agent |
| Cursor SDK + tool denylist, not fake OpenAI base URL | Agent |
| Kill per-tick LLM; slim board; sales cache | Agent |
| Delay mill truck so STOCK is observable | Agent |
| Goal stamp after celebration, not on first “ok” | Agent |
| Fallback to mock on provider start failure | Agent |

## Failures that taught the design

1. **Wrong localhost** — always bind and preview the same family (`127.0.0.1:5178`).
2. **Supervisor-on-every-tick** — looks agentic, invoices like a training run.
3. **Prompt-only safety** — insufficient; screen in code.
4. **Instant restock** — hides the sale; delayed side effects are part of the sim.
5. **Win condition on regex “yes”** — too eager; wait for the economic event + beat.

## What “done” means now

The office is a playable local demo: mock or live sales voice, real warehouse math, visible multi-agent floor, bounded spend. It is not a swarm of five always-on coding agents — that was the v1 drawing, and the log above is why it is not the shipping loop.
