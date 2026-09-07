# Engineering Spec

The Agentic Office is a Phaser 3 vintage office in the browser plus a Node harness that owns time, inventory, money, and the agents. Locally that is two processes; after `npm run build` (Docker/ECS) it is one process on `HOST:8787`.

## 1. Requirements

### 1.1 Product

| ID | Requirement |
| --- | --- |
| P1 | Bird’s-eye vintage PC game of a paper-company office, using the isometric floorplan as the map (not a redrawn pixel office). |
| P2 | Each worker on the floor is a named agent with role, personality, home desk, and goals. |
| P3 | Agents coordinate toward one **company goal** the player picks in Settings. |
| P4 | The human player is the **inbound caller**, not an invisible operator. The call rings at Pam; she transfers to Jim or Dwight (whoever the caller asked for). |
| P5 | Inter-agent talk is visible: speech balloons, watercooler (broadcast), DMs, standup in the conference room. |
| P6 | HQ can still be asked a question via balloon (`ask_human`); the graph pauses that channel until a short reply. |
| P7 | Commerce is real: 20 SKUs from `stock_definitions.md`, cash balance, daily earnings, token spend on the books. |
| P8 | Mock mode is first-class. The office must run with **no API keys**. |
| P9 | Live providers (OpenAI, Anthropic, Cursor) are pluggable behind the same event protocol. |
| P10 | Human asks stay inside the paper business (phone small talk is fine): no shells, no web, no jailbreaks, no token dumps. |

### 1.2 Non-goals (v1)

- Pathfinding around furniture
- Voice, 3D, or a custom-drawn map
- Autoscaling or more than one live office (one in-memory session)
- Fifteen concurrent LLM workers
- Agents that can read/write this repo or the internet

## 2. Architecture

```
┌─────────────────────────────────────────────┐
│  Browser  http://127.0.0.1:5178             │
│  Vite + Phaser 3                            │
│  Boot → Intro → Settings → Office           │
│  Call window (dial / hangup) + Web Audio    │
│  OfficeClient  ──WebSocket /ws──┐           │
└─────────────────────────────────┼───────────┘
                                  │ proxy (dev)
┌─────────────────────────────────▼───────────┐
│  Harness  HOST:8787                         │
│  Hono + ws  (+ dist/ after npm run build)   │
│  OfficeSession (clock, ticks, emit)         │
│    ├─ environment  (login / standup / lunch)│
│    ├─ beats        (inbound call, floor)    │
│    ├─ MockEngine   (scripted sales + day)   │
│    ├─ graph.ts     (LangGraph react agent)  │
│    ├─ cursorEngine (Cursor SDK, office-only)│
│    ├─ tools.ts     (say, pitch, ring_up…)   │
│    ├─ memory.json  (long-term file store)   │
│    └─ guardrails   (human + tool screens)   │
└─────────────────────────────────────────────┘
```

Three packages of code share one event schema (`src/shared/`):

| Tree | Owns |
| --- | --- |
| `src/game/` | Scenes, sprites, HUD, call window, camera, Web Audio. Interpolates events; does not simulate the business. |
| `src/harness/` | Clock, blackboard, tools, LLM/Cursor/mock engines. Source of truth. |
| `src/shared/` | Types, roster, catalog, commerce, guardrails, clock math. Imported by both. |

Simulation is **not** frame-tied. Phaser runs at display refresh; the harness ticks on `SPEED_MS` (`slow` 5s, `normal` 2.2s, `fast` 1.1s) and pushes `OfficeEvent` JSON over WebSocket.

## 3. Constraints

| Constraint | Value | Why |
| --- | --- | --- |
| Bind | Local `127.0.0.1`; `HOST=0.0.0.0` in Docker/ECS | Keys stay in harness `.env` / Secrets Manager, never the browser |
| Human line | ≤ 180 chars / 40 words / 80 estimated tokens | Stop prompt stuffing; phone small talk is allowed |
| Day token cap | 10,000,000 (~$0.12 at $0.25 / 1M) | Hard stop on LLM spend |
| Speech balloon | ~110 chars on the floor, 140 in chat | Vintage UI, readable overlay |
| Sales LLM | **Only** on a novel customer reply | Idle ticks used to burn a full office prompt every 2.2s |
| Cursor tools | `mcp` + custom office tools; shell/read/edit/web **disallowed** | Agents must not leave the paper office |
| Cursor cwd | OS temp dir, sandboxed | Must not edit this repo |
| API keys | Harness `.env` only | Settings copy: “API keys stay in the harness .env — never in the browser.” |
| Restock cost | 20% of list × units to fill the cage | Warehouse is not free |
| Restock delay | 36 ticks after Angela asks Pam | So STOCK actually drops after a sale |
| Clock | 1 sim-minute per tick, Mon 09:00–17:00 | Real-time enough to play as the caller |

## 4. Acceptance criteria

A build is acceptable when all of the following hold.

### 4.1 Game loop

- [x] Intro boots, Settings persist provider/goal/speed/sound, Office loads the floorplan.
- [x] Five color-coded workers sit on calibrated zone anchors (Jim/Dwight at desks, Pam left of reception).
- [x] Camera pan/zoom; MENU returns to title (ESC does not quit).
- [x] Call window is small, draggable, minimizable; Jim/Dwight dial buttons and HANG UP.
- [x] HUD shows clock, goal, books, Jira board, watercooler. Sound: ring / pickup / transfer / hangup / bell.

### 4.2 Office day

- [x] 09:00 LOG IN, 10:00 standup in conference, 12:00 lunch, 17:00 wrap — without a human click.
- [x] Inbound dial: ring → Pam pickup + greeting → transfer → Jim or Dwight hello. Caller chooses the desk.
- [x] Purchase only after a quote (`dealIsQuoted`); “I’ll take them” / yes-after-quote rings up stock and cash; tickets move. A new spec updates the pitch instead of closing the old SKU.
- [x] $100+ sale rings Pam’s bell; Michael congratulates the closer.
- [x] Reorder min → Angela walks to Pam → mill truck later → cage back to `startQty`, balance charged 20%.
- [x] Ambient bits (fire, fax, cats, coffee, boom) fire on their own and do not yank people home mid-scene.

### 4.3 Agents and safety

- [x] Mock completes a sale with no keys.
- [x] Live providers fall back to mock if start fails (missing key, Cursor error).
- [x] Guardrails refuse commands, URLs, off-topic, oversize, and post-cap asks; Jim/Dwight answer in character.
- [x] `npm run eval` passes (41 cases: guardrails, commerce, quote-gated yes, hangup, recycled spec, goals, canned-reply cache).
- [x] `npm run build` typechecks.

### 4.4 Playable goals

| Goal | Win |
| --- | --- |
| Close one phone sale | First successful ring-up |
| Make $250 / $1000 / $2000 today | `todayEarnings >= target` |
| Ring the $100 sales bell | Earnings ≥ $100 (bell also plays at $100+ on a single ticket) |
| Hold the price sheet | First close at list (no freelance discount in the model) |

## 5. Major technical decisions

| Decision | Choice | Alternatives rejected | Rationale |
| --- | --- | --- | --- |
| Game runtime | Phaser 3 in the browser | Electron+Phaser, Godot | Fastest overlay of the floorplan; easy iteration |
| Agent runtime | Pluggable harness: Mock / LangGraph react agent / Cursor SDK | CrewAI (Python), always-on supervisor swarm, Ollama-only | Same event bus; keys optional; later Cursor without rewriting the game |
| Orchestration | Shared blackboard + office clock + floor **beats**, not a free-form chat swarm | Per-tick LangGraph supervisor calling every worker | Supervisor was v1 intent; idle LLM ticks burned tokens. Clock/beats own the day; LLM owns novel sales lines |
| Player role | Inbound caller (Pam answers, then transfer) | Lobby walk-in; invisible HQ only | Makes the sale a phone game; reception is on the critical path |
| Sales voices | Jim (dry) + Dwight (strict); **caller chooses** | Straw draw / single salesperson | Pair still coworks; no forced first pitch |
| Movement | Zone lerp + unique stand-slots; recall wanderers | Full pathfinding | Floorplan is an image; collision would be fake |
| Memory | Short-term ring buffer (8) + file-backed keyword long-term (`data/memory.json`) | Embeddings from day one | Cheap, inspectable; embeddings can slot in later |
| Token control | Scripted floor + canned/cache sales + slim board + day cap | Always-on Cursor agent | Direct response to runaway spend |
| Guardrails | Regex/policy screen **before** the model, plus tool-text screen | Prompt-only “please don’t” | Models ignore style prompts; business must fail closed |
| Ports | Vite `5178`, harness `8787` | Default Vite `5173` | `5173` was already bound on this machine |

## 6. Data and events

Canonical types live in `src/shared/types.ts`.

**Client → harness:** `start`, `customer_say`, `human_reply`, `dial`, `hangup`, `set_speed`.

**Harness → game:** `session_started`, `tick`/`clock`, `say`/`whisper`/`watercooler`/`dm`, `meeting_*`, `customer_line`, `ask_human`, `move_to`, `task_update`/`queue_update`, `books`/`stock`/`sale`/`reorder_*`, `bell`, `phone` (`ring`/`pickup`/`transfer`/`hangup`), `fire`, `goal_met`, `guardrail`, `error`.

Call state on the blackboard: `callPhase` `idle` → `ringing` → `pam` → `live`. `pitch_customer` is refused unless the line is `live`.

Warehouse seed is `stock_definitions.md` → `src/shared/catalog.ts` (prices USD per unit, starting cash `$6,000`).
