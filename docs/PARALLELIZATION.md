# Parallelization Evidence

Parallelism in this project is **process-level**, **workstream-level**, and **floor-cast-level**. It is not “five LLMs every tick.” That design was tried in spirit (LangGraph supervisor + per-worker react agents) and **deliberately serialized** for cost after idle ticks burned a full office prompt every ~2.2s.

## 1. Two OS processes, always

`npm run dev` runs:

```
concurrently -n game,harness
  vite                          → :5178
  tsx watch src/harness/server.ts → :8787
```

Evidence: `package.json` script `dev`, Vite proxy of `/ws` + `/health` + `/session` in `vite.config.ts`. The game interpolates; the harness simulates. Either can restart without the other (HUD shows `WAITING FOR HARNESS` if the socket drops).

## 2. Product workstreams that run without waiting on each other

On each harness tick, independent subsystems share `OfficeState` under a single `busy` lock (one tick at a time so the blackboard stays consistent), but **they are separate workstreams** and only one LLM path is eligible:

| Stream | Parallel with | Blocked by |
| --- | --- | --- |
| Clock + HUD books | everything | nothing |
| Floor beats (inbound call, fire, fax, coffee, Whazup) | sales wait | meeting, existing beat queue |
| Wanderer recall (desks) | beats | meeting / active beat |
| Guardrail screen | before any model | nothing — fail closed |
| Canned sales cache | skips LLM | miss → live agent |
| Live sales agent | not overlapping another LLM tick | `pendingHuman`, token cap, beat drain |
| Phaser render / camera / chat UI | harness | WebSocket |

The important split after the token incident: **ambient office ≠ model**. Scripted beats and schedule keep five people moving while a live provider is idle or waiting on you.

## 3. Cast acting together on one beat

Beats are a queue of atomic actions, but many scenes **stage multiple agents in the same beat list** so they play as a simultaneous scene, not a single narrator.

**Inbound call** (`queueInboundCall`): Pam status + say + `phone` ring/pickup, then transfer beats (`queueTransferCall`) move Jim or Dwight onto the line — two people in one scene, no straw draw.

**Coffee** (`queueCoffee`): Jim and Pam both `move` to `kitchen`, both `say` `"..."`, both return. Two sprites walk at once on the next ticks.

**Login** (`applyLogin`): all five agents emit `status: logged in` in one schedule hit.

**Standup** (`applyStandup`): all five `move_to` `conference_room` in one event burst; `scriptedMeetingTurn` then round-robins lines.

**Sale celebration** (`queueSaleCelebration`): Michael walks to the closer’s desk, both speak, Pam may ring the bell — overlapping the customer’s closed chat.

**Fire**: Dwight leaves the bullpen while others keep their last status; the fire sprite is a separate render stream (`OfficeScene.showFire`).

Evidence: `src/harness/beats.ts` (`queueInboundCall`, `queueTransferCall`, `queueCoffee`, `queueSaleCelebration`), `src/harness/environment.ts` (`applyLogin`, `applyStandup`).

## 4. What is explicitly *not* parallel (and why)

| Design | Status | Why |
| --- | --- | --- |
| LangGraph `createSupervisor` fanning out Michael/Pam/Jim/Dwight/Angela every tick | **Not shipping** | `@langchain/langgraph-supervisor` remains in `package.json` from v1; `graph.ts` now starts a **single** `createReactAgent` for the salesperson who must answer |
| Cursor `task` / subagents | **Disallowed** in `cursorEngine.ts` `BLOCKED_TOOLS` | Office agents must not spawn coding workers |
| Overlapping LLM calls | **Gated** by `state.busy` | One blackboard writer |

So: **throughput parallelism** is processes + floor streams + multi-sprite beats. **Model parallelism** is capped at one sales reply.

## 5. Build-time parallel workstreams

The v1 plan decomposed the greenfield into independent streams that could (and did) proceed without waiting on live LLM quality:

```
[1] Vite/Phaser boilerplate     ─┐
[2] Floorplan + sprites + HUD   ─┼─ shared OfficeEvent schema
[3] Hono/WS + MockEngine        ─┘
[4] LangGraph / Cursor adapters     (same schema, later)
[5] Browser verify
```

Human decision at plan time: Phaser (browser) + LangGraph-style harness with **your** API keys, mock first. Cursor SDK was added later as a fourth provider without changing the game protocol.

During implementation, tool calls were batched (status + diff + log, or several file reads) so game and harness files could be inspected together. The architectural split (`src/game` vs `src/harness` vs `src/shared`) is what made that safe: the UI cannot call OpenAI; the harness cannot draw Phaser.

## 6. How to observe it

1. `npm run dev` — two colored `concurrently` prefixes (`game`, `harness`).
2. Open the office in Mock, **Fast**. Dial Jim or Dwight. Hear the ring; Pam picks up while Jim and Dwight stay at their desks. After you answer her, the transfer and sales hello play without another click.
3. Wait for coffee or fire: two people move, or Dwight peels off while you are still on the line.
4. Harness stdout: `[office …] [tick]` vs `[event]` vs `[sales]` / `[cursor]` — clock events continue while a live `cursor` sales-reply is in flight (next ticks no-op on `busy`, then resume).
