# Product Gap Analysis

Where the product stands against the target: *an AI customer service operating system for businesses on WhatsApp*.

Legend: **Have** shipped and verified · **Partial** exists but incomplete · **Missing** not started

## Against the three questions that matter

| Question | Today |
|---|---|
| Can the AI handle the customer? | Partially. It answers from a fixed prompt, with no memory of who the customer is and no way to check a fact. |
| Can the AI take action? | No. It can only produce text. |
| Can the business owner understand the result? | Partially. Volume, AI-versus-human split, after-hours count and reply time exist; nothing about leads, bookings or AI quality. |

## Phase-by-phase

| Phase | State | What exists | What is missing |
|---|---|---|---|
| 1 Audit | Have | `docs/ARCHITECTURE_AUDIT.md` | — |
| 2 Customer profile | Missing | `conversations.name`/`phone` only | Customer entity, status, lead status, tags, notes, preferences, history, AI summary, context panel |
| 3 Conversation intelligence | Missing | — | Intent, sub-intent, sentiment, confidence, urgency, escalation signal, storage and display |
| 4 Knowledge base | Missing | Business facts hardcoded in `system-prompt.ts` | Structured entries, retrieval layer, freshness, "do not invent" discipline |
| 5 Tool/action system | Missing | — | Tool contract, execution loop, recorded outcomes, truthful failure handling |
| 6 Human handoff | Partial | Agent/Draft/Human modes, manual switching, draft approval | Automatic escalation rules, escalation reason, handoff summary, needs-human state |
| 7 Smart inbox | Partial | List sorted by activity, unread dot, mode badge | Filters, sorting options, intent and lead indicators, waiting-state |
| 8 Follow-up automation | Missing | — | Scheduler, triggers, conditions, actions, cancel-on-reply |
| 9 Analytics | Partial | Conversations, messages, AI-alone, after-hours, median reply, awaiting reply, daily chart, 7/30 day | Lead and booking funnel, escalation rate, AI resolution and failure rates, customer cohorts, 90 days |
| 10 AI quality centre | Missing | — | Resolution and failure tracking, tool failures, knowledge gaps, review queue, feedback capture |
| 11 Conversation UI | Partial | Two-pane inbox, bubbles, delivery ticks, reply window, draft card, mode toggle | Right-hand customer panel, header status/intent/confidence, quick actions |
| 12 Admin settings | Missing | Environment variables and code constants | Business profile, AI settings, knowledge editor, automation editor |
| 13 Observability | Missing | `console.error` only | Event table, typed events, queryable trail |
| 14 Reliability | Partial | Inbound dedupe, store-before-ack, read retries, status rank guard, Meta retry on 500 | Outbound idempotency, tool timeouts, rate limiting, queue for slow work |
| 15 Security | Partial | Signed webhooks, service-role-only DB, signed cookie, locked-when-unconfigured | Per-user accounts, authorization, audit trail, tenant isolation, retention and deletion |
| 16 Multi-tenant | Missing | Single business throughout | Organization hierarchy, per-tenant number/config, scoped queries |
| 17 Prompt architecture | Missing | One 53-line prompt string | Composable sections assembled per request |
| 18 Performance | Partial | Single-query list, debounced refresh, indexes | Pagination, cached configuration, SQL-side analytics, virtualised history |

## Constraints that shape sequencing

1. **AI budget.** The account has $0 credit on the free tier: 50 requests/day, and free endpoints generally permit training on prompts. Intelligence and tool calling multiply calls per message. Treat credit top-up plus a paid no-training model as a prerequisite for Phases 3 and 5 in production, and keep both behind flags so the demo keeps working.
2. **Tool calling support.** Tools require a model that implements function calling. The configured free model may not; the code must detect this and degrade to reply-only rather than fail.
3. **No backups.** Supabase free plan, PITR off, zero stored backups. Schema changes should be preceded by an export.
4. **No tests.** Nothing guards a refactor of this size. A test runner comes before the large changes, not after.
5. **Single operator.** One shared password. Per-user identity is required before "who overrode the AI" can be answered, which Phase 10 depends on.

## Value versus effort

| Item | Business value | Effort | Verdict |
|---|---|---|---|
| Customer profile | High: every other feature hangs off it | Medium | Do first |
| Knowledge base + retrieval | High: stops invented answers | Medium | Do first |
| Conversation intelligence | High: makes the inbox triageable | Medium | Do first |
| Tool layer + bookings | Highest: this is what a clinic pays for | High | Do next |
| Escalation and handoff summary | High: the trust objection | Low once intelligence exists | Do next |
| Smart inbox | Medium-high: daily operator value | Low-medium | Do next |
| Analytics upgrade | High for renewal conversations | Medium | After P0 |
| Follow-up automation | High revenue, needs a scheduler | High | After P0 |
| AI quality centre | Medium now, high at scale | Medium | After P1 |
| Multi-tenancy | Zero until the second paying client | High | Prepare only |
| Automation builder UI | Low until automations exist | High | Later |

## Explicit non-goals for this pass

- No multi-tenant rollout; only `organization_id` on new tables so it stays cheap later.
- No embeddings or vector database; keyword retrieval over structured entries is adequate for a few dozen business facts.
- No template messaging or 24-hour re-engagement, which is its own Meta approval workflow.
- No visual automation builder; automations start as configuration rows.
