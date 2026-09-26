# Implementation Plan

Companion to `ARCHITECTURE_AUDIT.md` and `PRODUCT_GAP_ANALYSIS.md`. Scope of this plan: the P0 set, with P1 sketched. Every step is independently shippable and leaves the product working.

## Current state → target state

| | Current | Target (end of P0) |
|---|---|---|
| Customer | A row in `conversations` keyed by phone | First-class `customers` with status, lead status, tags, notes, AI summary, history |
| Business knowledge | 53-line prompt string in code | `kb_entries` rows retrieved per message, editable without deploying |
| AI capability | Produces text | Produces text, classifies intent, and calls tools whose results are recorded |
| Escalation | Operator flips a toggle | Rules raise `needs_human` with a reason and a written handoff summary |
| Inbox | Sorted by recency | Filterable by state, intent and lead, sortable by attention |
| Prompt | One string | Sections assembled per request |
| Observability | `console.error` | `events` table, queryable by conversation and type |
| Tenancy | Implicitly single | Still single, but every new table carries `organization_id` |

## Database changes

One idempotent migration file per step, applied via the Supabase migrations API, mirrored in `supabase-schema.sql`.

```sql
-- P0.1 foundation
organizations(id, name, timezone, created_at)                     -- seeded with one row
customers(id, organization_id, phone, wa_id, name,
          status[NEW|LEAD|QUALIFIED|BOOKED|ACTIVE_CUSTOMER|RETURNING_CUSTOMER|INACTIVE],
          lead_status, tags text[], preferences jsonb, ai_summary,
          first_contact_at, last_interaction_at, conversation_count,
          created_at, updated_at)
  unique (organization_id, phone)

conversations
  + organization_id, customer_id FK
  + intent, sub_intent, sentiment, urgency, ai_confidence numeric
  + needs_human boolean, escalation_reason, escalation_summary, escalated_at
  + resolved_at
  (conversations.phone kept during transition; unique constraint moves to customers)

notes(id, organization_id, customer_id, conversation_id, author, body, created_at)
events(id, organization_id, conversation_id, customer_id, type, status,
       detail jsonb, created_at)                                  -- no message content
kb_entries(id, organization_id, category, question, answer, tags text[],
           is_active, updated_at)                                 -- tsvector index for retrieval
tool_calls(id, organization_id, conversation_id, tool, arguments jsonb,
           result jsonb, status[ok|failed], error, duration_ms, created_at)
appointments(id, organization_id, customer_id, conversation_id, service,
             starts_at, ends_at, status[requested|booked|rescheduled|cancelled|completed|no_show],
             created_by[ai|human], notes, created_at, updated_at)
message_analysis(id, message_id FK, intent, confidence, sentiment, created_at)
```

Backfill: one customer per existing conversation (phone, name, first/last interaction from message timestamps), then `conversations.customer_id` set. No fuzzy merging.

Indexes: `customers(organization_id, phone)`, `conversations(organization_id, needs_human, updated_at desc)`, `events(conversation_id, created_at desc)`, `kb_entries` GIN on the search vector, `appointments(organization_id, starts_at)`.

## API changes

| Route | Change |
|---|---|
| `GET /api/conversations` | Accepts `filter` and `sort`; returns customer summary, intent, confidence, needs_human |
| `GET /api/customers/[id]` | New: profile, tags, notes, appointments, AI summary |
| `PATCH /api/customers/[id]` | New: status, lead status, tags, preferences |
| `POST /api/customers/[id]/notes` | New |
| `POST /api/conversations/[id]/escalate` | New: manual handoff with generated summary |
| `POST /api/conversations/[id]/resolve` | New: closes the loop for resolution metrics |
| `GET/POST/PATCH/DELETE /api/kb` | New: knowledge base CRUD |
| `GET /api/appointments`, `POST /api/appointments` | New: used by tools and the UI |
| `GET /api/stats` | Extended: lead/booking funnel, escalation rate, AI resolution, 90-day range |
| `GET /api/events` | New: filtered event trail for the quality view |

Existing routes keep their current contracts; new fields are additive.

## Frontend changes

- **Right-hand customer panel** in the conversation view: identity, status, tags, AI summary, appointments, notes, quick actions (book, reschedule, cancel, tag, note, handoff, follow-up).
- **Conversation header**: status, intent, confidence, mode, needs-human marker.
- **Inbox**: filter row (All, Unresolved, Needs Human, New Leads, High Intent, Booked, Waiting Customer, Waiting Business, Complaints, AI Handled) and sort control; intent and lead chips on rows.
- **Settings pages**: business profile, AI settings, knowledge base editor.
- **Analytics**: funnel and AI-quality sections alongside the existing tiles; 7/30/90 day ranges.

UI discipline stays as-is: dark, flat, information-dense, no decorative gradients or glow, numbers in plain ink with colour reserved for state.

## AI architecture changes

```
src/lib/ai/
  prompt/core.ts          CORE_SYSTEM_PROMPT (behaviour, honesty rules)
  prompt/business.ts      BUSINESS_CONTEXT from organizations + settings
  prompt/customer.ts      CUSTOMER_CONTEXT from customers
  prompt/knowledge.ts     KNOWLEDGE_CONTEXT from retrieval, with freshness
  prompt/tools.ts         tool definitions for the model
  prompt/escalation.ts    ESCALATION_RULES
  prompt/assemble.ts      composes the above in a fixed order
  tools/                  one file per tool + a registry
  engine.ts               model call, tool loop, escalation decision
  classify.ts             intent metadata (merged into the reply call)
```

Two decisions worth stating:

1. **One model call, not three.** Reply text and metadata (intent, confidence, escalation) come back in a single structured response. Separate classification calls would triple cost and latency for no accuracy gain at this size.
2. **Keyword retrieval before embeddings.** `kb_entries` are searched with Postgres full-text. A few dozen business facts do not justify a vector store; the retrieval interface stays swappable.

Honesty rules enforced in code, not just prompt text: a tool result is the only thing that may be reported as done, and `tool_calls.status` is written before any confirmation reaches the customer.

## Integration changes

- **Appointments** are internal first (`appointments` table). Calendar sync is a later adapter behind the same tool interface.
- **Scheduler** for follow-ups (P1): a `scheduled_jobs` table plus a Vercel cron route, since `after()` cannot run work hours later.
- **Model**: capability detection at call time; if tools are unsupported the engine degrades to reply-only and logs a `tool_support_missing` event.

## Migration strategy

1. Export both tables to JSON before each schema step (no backups exist on the free plan).
2. Apply an idempotent migration; keep old columns until the code no longer reads them.
3. Deploy code that tolerates both shapes, then remove the old path in a later step.
4. Verify after each step: type-check, lint, build, migration verification query, API probe, end-to-end script.

## Testing strategy

- Add **Vitest** for unit tests: prompt assembly, retrieval ranking, escalation rules, intent parsing, tool argument validation, analytics aggregation.
- Move the end-to-end scripts currently living in scratch space into `scripts/e2e/` so they are versioned: webhook → store → reply, draft approve/discard, delivery status, auth and access control.
- Tests must cover: never sending a duplicate WhatsApp message, never reporting a failed tool as success, and no cross-customer data leakage in list queries.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Free-tier request cap breaks demos once intelligence is on | High | One combined call; feature flag; top up credit before enabling |
| Free model lacks tool calling | Medium | Capability detection with reply-only fallback |
| Schema migration damages live data with no backup | Low, high impact | Export first; idempotent, additive migrations |
| Scope creep across 18 phases stalls delivery | High | Ship P0 in six independently deployable steps |
| Model invents bookings | Medium, high impact | Tool results gate all confirmations; failure copy is prescribed |
| Analytics queries slow as volume grows | Low now | Move aggregation into SQL when the JS pass exceeds ~10k rows |

## Sequence

**P0.0 Safety net** — Vitest, versioned end-to-end scripts, data export script. *Verify: tests run in CI-style command.*

**P0.1 Foundation schema** — organizations, customers, notes, events, kb_entries, tool_calls, appointments, message_analysis; conversation columns; backfill. *Verify: migration query, row counts, existing dashboard unaffected.*

**P0.2 Prompt architecture + knowledge retrieval** — split the prompt, seed `kb_entries` from today's clinic facts, retrieve per message. No user-visible change. *Verify: unit tests, identical reply quality on a replayed message.*

**P0.3 Conversation intelligence** — structured reply with intent, confidence, sentiment, urgency; persist to conversation and `message_analysis`; badges in the UI. *Verify: unit tests on parsing, end-to-end on a live message, badge rendering.*

**P0.4 Tool layer** — registry, validation, execution loop, `tool_calls` recording, booking tools over `appointments`. *Verify: tool unit tests, forced-failure test proving no false confirmation.*

**P0.5 Escalation and handoff** — rules engine, `needs_human`, reason, generated summary, UI treatment. *Verify: rule unit tests, end-to-end escalation.*

**P0.6 Smart inbox + customer panel** — filters, sorting, indicators, right-hand panel with actions. *Verify: API filter tests, screenshot review.*

Then P1: analytics upgrade, follow-up scheduler, AI quality centre.
