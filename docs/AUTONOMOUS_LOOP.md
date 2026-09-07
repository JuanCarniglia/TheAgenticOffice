# Autonomous Loop Evidence

Requirement: show at least one place where an agent **detected** a problem, **reacted**, and **continued** without another human instruction.

The office is full of those loops. The human only starts the session and (optionally) types in customer chat. Everything below runs off the clock.

## Loop 1 — Warehouse min → Angela → Pam → mill truck (primary)

This is the cleanest detect → react → continue story, and it was itself a correction: the first version restocked instantly, so STOCK looked unchanged after a buy.

**Detect.** `ringUp` in `src/shared/commerce.ts` sets `hitReorder` when `qty <= reorderAt` and the line has not already been flagged.

**React.** `applySale` emits `reorder_alert` and `queueReorderAsk`:

1. Angela `move_to` reception  
2. Angela `say`: `{label} is at {qty}. Reorder {need} to fill the cage.`  
3. Pam `say`: mill truck later; cage stays short  
4. Angela returns to accounting  
5. A shipment is scheduled `tick + 36`

**Continue.** Later ticks: `maybeDeliverShipments` sees `arriveTick`, Pam announces the truck, `restockToStart` fills to original qty, books pay **20% of list**. No second human prompt.

Evidence: `src/harness/beats.ts` (`queueReorderAsk`, `maybeDeliverShipments`, `SHIP_DELAY_TICKS = 36`), `src/harness/officeState.ts` (`applySale`).

**How to reproduce:** Mock, default pitch (30 reams A3, start 40, min ~11). Type `yes`. STOCK shows `10 / 40` with incoming; Angela walks; many ticks later the cage is 40 and cash dropped by the mill bill.

## Loop 2 — Fire on the floor, Dwight contains it

**Detect.** `maybeQueueAmbient` (after tick 50, every ~48 ticks, weighted random, not the same bit twice).

**React.** `queueFire`: sprite `fire on` in a random zone → Dwight status “sprinting” → `move_to` → *“Not a drill! Be professional, people!”* → `fire off` → *“Contained. As I planned.”* → back to `bullpen_dwight`.

**Continue.** Beat queue drains one action per tick; sales chat can still be waiting on you. You did not start the fire or tell Dwight to move.

Evidence: `src/harness/beats.ts` `queueFire`; `OfficeScene` `showFire` / `hideFire`.

## Loop 3 — Session start fails, office keeps running

**Detect.** `OfficeSession.start` `try/catch` around mock / graph / Cursor init (missing `CURSOR_API_KEY`, bad model, SDK throw).

**React.** Emit `{ type: "error", message }`, set `provider = "mock"`, `mock.reset`.

**Continue.** Clock arms, morning straw draw still happens. The player is not asked to re-click Start.

Evidence: `src/harness/session.ts` `start()`.

## Loop 4 — Token cap: stop spending, keep the day

**Detect.** `tokenBudgetSpent(todayTokens)` (`DAY_TOKEN_CAP = 500_000`) at the top of a non-mock tick.

**React.** One `error`: “Day token budget reached — agents will not take new LLM work.” `tokenCapNotified` so it does not spam.

**Continue.** Beats, schedule, mock-like floor motion still run; customer lines can still be canned. No new `createReactAgent` / `Agent.send`.

Evidence: `session.ts` tick; `guardrails.ts` `tokenBudgetSpent`.

## Loop 5 — Off-policy customer line, stay in character

**Detect.** `screenHumanText` on `customer_say`.

**React.** `guardrail` event + Jim/Dwight reply (*“We sell paper…”* / *“Rejected. This desk does not run commands…”*). `pendingCustomer` stays open on that refusal.

**Continue.** Tick loop resumes; you are not required to send a corrected line for the office to keep moving (Michael will still nag, Dwight may still find a fire).

Evidence: `session.ts` `customer_say` branch; `guardrails.ts` `guardrailReply`.

## Loop 6 — Wanderers recalled to desks

**Detect.** `recallWanderers`: Jim/Dwight on lobby-like zones, or Pam not at reception, and no meeting/beat in progress.

**React.** `move_to` home + status “back at desk” / “at reception”.

**Continue.** Next pitch still comes from the desk. This loop was added after humans observed the pair vanishing into the lobby.

Evidence: `src/harness/environment.ts` `recallWanderers`; `move_to` tool also refuses sales walking to waiting/entrance/reception.

## Loop 7 — Morning outreach without a human opening the chat

**Detect.** Live providers, tick ≥ 3, no meeting, no beats, `!morningPitched`, no `pendingCustomer`, `salesTurns === 0`.

**React.** Straw-draw beat list; winner `pitch` with `openingPitch`.

**Continue.** Chat waits on the customer. The scene does not start from a human action — a stated product requirement.

Evidence: `maybeQueueMorningOutreach` in `beats.ts`; Mock `MORNING` ops in `mockEngine.ts`.

## Build-time autonomous loop (agent building the product)

During development, the coding agent hit **Vite on IPv6 `:5173` while another app owned IPv4 `:5173`**, detected the wrong preview target, moved the game to **5178**, updated the proxy, and continued verification without a new architecture instruction. Same pattern later: quarterly-review stamp firing on a loose “yes” → traced `goal_met` → delayed until Michael’s congratulations; mill restock masking the sale → delayed truck. Those corrections are logged in [AI Development Log](AI_DEVELOPMENT_LOG.md).
