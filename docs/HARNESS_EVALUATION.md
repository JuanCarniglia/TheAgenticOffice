# Harness / Evaluation

The harness is both the **runtime** for the office and the **evaluation surface** for whether the product stays on-policy, on-budget, and commercially consistent.

## 1. Runtime harness

`src/harness/server.ts` — Hono + WebSocket.

| Endpoint | Role |
| --- | --- |
| `GET /health` | `{ ok, service: "agentic-office-harness" }` |
| `GET /session` | Blackboard snapshot (tasks, books, stock, chat) |
| `POST /session/start` | Same payload as WS `start` |
| `WS /ws` | Bidirectional `ClientMessage` / `OfficeEvent` |

`OfficeSession` is the control loop: screen inputs, tick the clock, choose mock vs graph vs Cursor, emit events, meter tokens.

## 2. Mock engine as a deterministic eval double

`MockEngine` implements the **same tools and events** as live agents with canned ops (`MORNING`, `IDLE`, `AFTERNOON`). It is how the game shipped before keys, and how a reviewer can replay:

- straw draw + opening pitch
- purchase → `applySale` → tickets AO-3/AO-4/AO-5/AO-2 done
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
| Weather/bitcoin/poem without paper terms | customer/HQ | `off_topic` |
| Length > 160 chars / 32 words / 80 tokens | all | `too_long` |
| ≥7 words and no business lexicon | customer/HQ | `off_topic` |
| Goal with no paper-office terms | goal | `off_topic` → default goal |

The game UI screens the same way (`CustomerChat`, Settings goal, HQ reply box) so a blocked line never has to round-trip. The harness screens again so a raw WS client cannot bypass the UI.

Tool outputs get `screenToolText` (commands/dumps only) so gossip still files.

Live prompts also prepend `BUSINESS_GUARDRAIL_RULES` (stay in the office, no shell, no files, no web). Policy is **code + prompt**, not prompt alone.

## 4. Offline eval suite

```bash
npm run eval
```

`scripts/eval.ts` runs without servers or keys. Last run: **22/22 passed**.

| Bucket | What it proves |
| --- | --- |
| Guardrails | Commands, URLs, jailbreak/off-topic, long lines, token cap, legal order, legal goal |
| Commerce | 30-ream A3 sale drops 40→10, $255 revenue, reorder flag, oversell refused |
| Matching | SKU from text, qty vs GSM |
| Intent | `looksLikePurchase` / `looksLikeRejection`, `$1000` goal miss/hit |
| Cache | Price question canned reply; normalized repeat hits cache |

`npm run typecheck` / `npm run build` (`tsc --noEmit`) is the compile gate.

There is no Playwright suite in-repo. Browser review during build used Cursor’s preview on `http://127.0.0.1:5178/` (intro, settings, overlay, balloon reply, office-day login/standup).

## 5. Review loops in the product

| Loop | Mechanism | Stop / continue |
| --- | --- | --- |
| Goal stamp | `goalReached` after celebration beats, not on the first “ok” | Stamp faded; used to fire too early |
| Reorder | `qty <= reorderAt` → Angela→Pam → 36-tick mill delay | STOCK stays down until the truck |
| Token budget | `TokenMeterHandler` + Cursor `usage.totalTokens` + char/4 fallback | Tick skips LLM; one `error` event |
| Provider failure | `start()` catch | Mock takeover |
| Wanderers | `recallWanderers` | Jim/Dwight/Pam pulled home if they loiter |
| Sales cache | `rememberSalesReply` | Repeat customer line skips the model |
| Cursor sandbox | `disallowedTools` + temp `cwd` | Cannot edit this repo or fetch the web |

## 6. Observability

`officeLog` / `summarizeEvent` (`src/shared/trace.ts`) print a single-line trace on both Node and the browser:

```
[office HH:MM:SS.mmm] [tick] #12 MON 09:12 mock waiting:jim
[office …] [event] sale jim 30 reams Copy Paper A3 80 g/m² +$255
[office …] [guardrail] customer too_long: Whoa — that's a novel…
[office …] [tokens] +842 day 842 $0.0002
```

BOOKS in the office menu shows balance, today’s cash, and token spend at `$0.25 / 1M`.

## 7. What we did not add

- No CI workflow in git yet (repo still has no commits).
- No embedding-based memory eval (keyword score only).
- No held-out sales-conversation gold set beyond canned regex + cache.
- Cursor/OpenAI/Anthropic live calls are **not** in `npm run eval` (cost and keys). Mock + guardrails + commerce cover the invariants those providers must not violate.

## 8. How to extend the eval

Add a `check(...)` in `scripts/eval.ts` for any new fail-closed rule (e.g. a new off-limits pattern or SKU). Keep live-provider probes manual: Settings → provider → one novel customer line, confirm BOOKS tokens move and a second identical line does not.
