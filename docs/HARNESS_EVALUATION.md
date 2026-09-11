# Harness / Evaluation

The harness is both the **runtime** for the office and the **evaluation surface** for whether the product stays on-policy, on-budget, and commercially consistent.

## 1. Runtime harness

`src/harness/server.ts` — Hono + WebSocket.

| Endpoint | Role |
| --- | --- |
| `GET /health` | `{ ok, service: "agentic-office-harness", game }` — `game` is true when `dist/index.html` exists |
| `GET /session` | Blackboard snapshot (tasks, books, stock, chat) |
| `POST /session/start` | Same payload as WS `start` |
| `WS /ws` | Bidirectional `ClientMessage` / `OfficeEvent` |

`OfficeSession` is the control loop: screen inputs, tick the clock, choose mock vs graph vs Cursor, emit events, meter tokens.

## 2. Mock engine as a deterministic eval double

`MockEngine` implements the **same tools and events** as live agents with canned ops (`MORNING`, `IDLE`, `AFTERNOON`). It is how the game shipped before keys, and how a reviewer can replay:

- inbound `dial` → Pam pickup → transfer → sales hello
- purchase after a quote → `tryCloseSale` / `applySale` → tickets AO-3/AO-4/AO-5/AO-2 done
- hangup / bye ends the line (`phone hangup`)
- HQ `human_reply` acknowledged
- schedule (login/standup/lunch/wrap)

If a live provider throws on start, the session **falls back to mock** and still emits a playable office (`session.ts` start `catch`).

## 3. Policy eval: guardrails

`src/shared/guardrails.ts` is a fail-closed reviewer **in front of** the model.

| Check | Channel | Fail reason |
| --- | --- | --- |
| Day token cap already spent | customer, HQ | `too_expensive` |
| Shells, `rm -rf`, npm/pip/git, URLs, “search the web”, jailbreaks | all | `off_limits` |
| “write a 500-word…”, dump entire X | all | `too_expensive` |
| Bitcoin / poem / other OFF_TOPIC without paper terms | HQ (customer allows ordinary phone chat) | `off_topic` |
| Length > 180 chars / 40 words / 80 tokens | all | `too_long` |
| ≥7 words and no business lexicon | HQ (not customer) | `off_topic` |
| Phone small talk (hi, weather, Monday) | customer | **allowed** — `screenHumanText` returns ok |
| Goal with no paper-office terms | goal | `off_topic` → default goal |

The game UI screens the same way (`CustomerChat`, Settings goal, HQ reply box) so a blocked line never has to round-trip. The harness screens again so a raw WS client cannot bypass the UI.

Tool outputs get `screenToolText` (commands/dumps only) so gossip still files.

Live prompts also prepend `BUSINESS_GUARDRAIL_RULES` (stay in the office, no shell, no files, no web). Policy is **code + prompt**, not prompt alone.

## 4. Offline eval suite

```bash
npm run eval
```

`scripts/eval.ts` runs without servers or keys. Last run: **91/91** cases in the file.

| Bucket | What it proves |
| --- | --- |
| Guardrails | Commands, URLs, jailbreak/off-topic, long lines, token cap, legal order, legal goal, **phone small talk allowed** |
| Commerce | 30-ream A3 sale drops 40→10, $255 revenue, reorder flag, oversell refused |
| Matching | SKU from text, qty vs GSM |
| Intent | Quote-gated yes/ok; lone yes is not a buy; recycled spec is not a close; hangup vs “by the way”; `$1000` goal miss/hit |
| Canned sales | Price question; greeting has no price dump; repeats re-read live qty/stock (no conversation cache) |
| Spec change | “recycled, legal, 35” updates pitch SKU/qty and quotes recycled — does not ring up the A3 |
| Call / memory | Hangup clears `callPhase`; slim board includes a recalled requirement; Mock cannot enable Live office |
| Close / hangup | Sale thanks then delayed silent hangup; leftover chat yes does not re-ring; slim board shows already sold |
| Call privacy | Fire / WHAZUUUP / coffee hold during a live sale; 10:00 standup waits until hangup |
| Directed voice | Mock `performLine` returns the fallback; live providers perform a cue in character |
| Idle lock | Wall-clock 3 minutes without player chat (`IDLE_LOCK_MS` / `idleLockDue`) |
| Quiet logs | `tick` / `clock` are not printed |
| Env settings pins | `PROVIDER` / `MODEL` / `FLOOR` parse + apply; mock cannot be forced live |

`npm run typecheck` / `npm run build` (`tsc --noEmit`) is the compile gate.

There is no Playwright suite in-repo. Browser review during build used Cursor’s preview on `http://127.0.0.1:5178/` (intro, settings, overlay, inbound call, hangup, office-day login/standup).

## 5. Review loops in the product

| Loop | Mechanism | Stop / continue |
| --- | --- | --- |
| Goal stamp | `goalReached` after celebration beats, not on the first “ok” | Stamp faded; used to fire too early |
| Quote-gated close | `looksLikePurchase(text, dealIsQuoted)` — lone yes is not a buy; “yes I want all / more” is a qty change | Recycled/spec change updates pitch, does not ring the old SKU |
| Inbound call | `dial` → Pam → transfer; `hangup` / bye clears the line | `pitch_customer` refused unless `callPhase === live` |
| Sale hangup | Successful `tryCloseSale` thanks first; silent hangup waits `linePlayMs` so chat can finish typing | A later “yes” needs a new quote; leftover thanks in chat is not a quote |
| Floor hold | Ambient `hold` beats park while `isSalesCallActive`; standup `markFired` + flush after hangup | `call_meeting` refused on an open sales call |
| Reorder | `qty <= reorderAt` → Angela→Pam → 36-tick mill delay | STOCK stays down until the truck |
| Token budget | `TokenMeterHandler` + Cursor `usage.totalTokens` + char/4 fallback | Tick skips LLM; Live office falls back to Scripted; Michael announces |
| Live office supervisor | Event only: standup, 3-turn stall, reorder, $100 sale | Never per clock tick; `trace` + WHO’S UP |
| Idle lock | 3 min wall-clock with no player chat (`office_locked`) | Stamp + title; harness `stop()` so ticks/LLMs stop |
| Leave office | MENU / last WebSocket close sends `stop` | Clock and Cursor/LLM work halt on the title screen |
| Provider failure | `start()` catch | Mock takeover |
| Wanderers | `recallWanderers` | Jim/Dwight/Pam pulled home if they loiter |
| Sales replies | `cannedSalesReply` from live office state | No conversation cache — repeats re-evaluate qty/stock |
| Cursor isolation | `disallowedTools` + temp `cwd`; OS sandbox off (not supported here) | Cannot edit this repo or fetch the web |

## 6. Observability

`officeLog` / `summarizeEvent` (`src/shared/trace.ts`) print a single-line trace on both Node and the browser:

```
[office HH:MM:SS.mmm] [tick] #12 MON 09:12 mock waiting:jim
[office …] [event] sale jim 30 reams Copy Paper A3 80 g/m² +$255
[office …] [guardrail] customer too_long: Whoa — that's a novel…
[office …] [tokens] +842 day 842 $0.0002
```

BOOKS in the office menu shows balance, today’s cash, token spend at `$0.25 / 1M`, and **last live turn** tokens. WHO’S UP shows the last tool (`trace` events).

## 7. What we did not add

- No CI workflow in git yet (`main` is the Initial Version commit; eval is local `npm run eval`).
- No embedding-based memory eval (keyword score only).
- No held-out sales-conversation gold set beyond canned regex + cache.
- Cursor/OpenAI/Anthropic live calls are **not** in `npm run eval` (cost and keys). Mock + guardrails + commerce cover the invariants those providers must not violate.

## 8. Manual Live office checklist

Settings → Provider **OpenAI** (or Anthropic) → Floor intelligence **Live office** → **Fast**.

1. Dial Jim. Pam still answers (scripted). After transfer, say something novel (not a cached price ask).
2. Confirm a `trace` in WHO’S UP / harness log and BOOKS **last live turn** tokens move.
3. Ask for recycled legal 35. Second call: “the recycled thing” should not re-quote A3 from scratch (memory on the slim board).
4. Three novel turns without a close: Michael supervisor `trace` (`stall`).
5. 10:00 standup: supervisor `assign_task` or a Michael line — not five scripted standup quotes.
6. Hang up. A new call starts a new LangGraph thread (`call-{session}-{agent}-{gen}`).

Mock stays Scripted. Live office + missing key falls back to mock as before.

## 9. How to extend the eval

Add a `check(...)` in `scripts/eval.ts` for any new fail-closed rule (e.g. a new off-limits pattern or SKU). Keep live-provider probes manual: Settings → provider → one novel customer line, confirm BOOKS tokens move and a second identical line does not.
