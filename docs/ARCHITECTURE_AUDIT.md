# Architecture Audit

Audit date: 2026-09-27 · Commit: `7b8bc9d` · Deployed at `whatsapp-agent-iter8.vercel.app`

## 1. Snapshot

| | |
|---|---|
| Source | 2,542 lines across 29 files (`src/`) |
| API routes | 8 |
| Database | 2 tables, 19 columns, 5 conversations, 69 messages |
| Tests | none (no test runner installed) |
| Runtime deps | `next` 16.2.1, `react` 19.2.4, `@supabase/supabase-js`, `openai`, `pg` (unused) |

## 2. Stack

| Concern | Implementation |
|---|---|
| Framework | Next.js 16 App Router, TypeScript strict, Turbopack |
| UI | React 19 client components, Tailwind CSS 4, dark theme only |
| Backend | Next route handlers (no separate server) |
| Database | Supabase Postgres 17 (`ap-southeast-2`), accessed via PostgREST |
| Auth | Single shared password, HMAC-signed cookie, enforced in `src/proxy.ts` |
| WhatsApp | Meta Cloud API v22.0, raw `fetch`, webhook at `/api/webhook` |
| AI | OpenRouter through the `openai` SDK, one chat completion per reply |
| Realtime | Supabase Broadcast pings from server; dashboard reloads over its API |
| Hosting | Vercel (production branch `main`), auto-deploy on push |

## 3. Data flow

**Inbound message**

```
Meta → POST /api/webhook
  → verify X-Hub-Signature-256 (when WHATSAPP_APP_SECRET set)
  → parseWebhookPayload: extract messages, ignore statuses/reactions
  → upsertConversation(phone, name)
  → saveMessage(role user, whatsapp_msg_id)     ← dedupes redeliveries
  → notifyDashboard(conversationId)              ← Broadcast ping
  → respond 200 (500 only if storage failed, so Meta retries)
  → after(): generateReply → toWhatsAppFormat
        agent mode → sendWhatsAppMessage → saveMessage(sent_by ai, status sent)
        draft mode → saveDraft (waits for human approval)
        human mode → nothing
```

**Delivery reports** arrive on the same webhook and update `messages.status` with a rank guard so a late report cannot move a message backwards.

**Dashboard**: every read goes through authenticated API routes using the service role key. The browser holds the anon key only to subscribe to update pings; it cannot read the tables.

## 4. Data model (current)

```
conversations(id, phone UNIQUE, name, mode[agent|draft|human],
              draft_reply, draft_created_at, last_read_at, updated_at, created_at)
messages(id, conversation_id FK CASCADE, role[user|assistant], sent_by[ai|human],
         content, whatsapp_msg_id UNIQUE, status[sent|delivered|read|failed],
         status_detail, status_updated_at, created_at)
```

Indexes: `idx_messages_conversation`, `idx_conversations_updated`, plus the two unique constraints. RLS enabled on both tables with **zero policies**, so only the service role can read or write.

## 5. API surface

| Route | Auth | Notes |
|---|---|---|
| `GET/POST /api/webhook` | Meta signature | Public by necessity |
| `GET /api/conversations` | session | One query with embedded last message |
| `PATCH /api/conversations/[id]` | session | mode, read, discardDraft |
| `GET /api/conversations/[id]/messages` | session | Latest 500, oldest first |
| `POST /api/conversations/[id]/send` | session | Sends, then stores; 502 surfaces Meta's error |
| `GET /api/stats` | session | Aggregates in JS over the period's messages |
| `POST /api/auth/login`, `/logout` | — | Password to signed cookie |

## 6. What is already right (preserve)

- **Webhook discipline**: store-before-acknowledge, unique `whatsapp_msg_id` dedupe, AI work in `after()` so Meta always gets a fast 200.
- **Honest delivery state**: Meta's asynchronous failures are recorded and surfaced, rather than assuming a send succeeded.
- **No public data path**: RLS with no policies plus content-free update pings.
- **Mode re-check before sending**: an operator taking over mid-generation cancels the AI's reply.
- **Small, typed, dependency-light modules** with a clean split between route handlers, `lib/` logic and components.

## 7. Weaknesses

| # | Issue | Severity |
|---|---|---|
| W1 | No customer entity. `conversations.phone` is the de facto customer, so history, tags, notes and status have nowhere to live | High |
| W2 | One monolithic system prompt with business facts hardcoded in `system-prompt.ts`; changing hours means a deploy | High |
| W3 | The AI can only talk. No tools, so it cannot check availability or book anything | High |
| W4 | No intent, sentiment, confidence or escalation signal, so the inbox cannot be triaged and escalation is manual | High |
| W5 | No tests and no test runner; verification scripts live outside the repo and vanish with the session | High |
| W6 | No structured logging. Failures are `console.error` in Vercel logs, unqueryable and not tied to a conversation | Medium |
| W7 | Analytics computed in JS over every message in the period; fine at 69 rows, wrong shape at 100k | Medium |
| W8 | Single tenant everywhere: one WhatsApp number, one business, one password, no `organization_id` | Medium |
| W9 | `conversations.phone` is globally unique, which blocks multi-tenancy outright | Medium |
| W10 | No outbound idempotency. A duplicated dashboard click or retried action can send the same WhatsApp message twice | Medium |
| W11 | No rate limiting on the webhook or login beyond a 400ms delay | Medium |
| W12 | Free AI model: prompts may be used for training, and the account is capped at 50 requests/day | High (business) |
| W13 | No backups (Supabase free plan, PITR off, zero stored backups) | High (business) |
| W14 | Unused `pg` dependency; `NEXT_PUBLIC_APP_URL` and `PORT` are set but unused | Low |
| W15 | 24-hour window is displayed but templates are unsupported, so re-engagement is impossible | Medium |

## 8. Security posture

Good: signed webhooks, service-role-only database access, HttpOnly signed session, secrets absent from git history, production locked when `DASHBOARD_PASSWORD` is unset.

Gaps: one shared password with no per-user identity or audit trail; no authorization model (every signed-in user is an admin); no tenant isolation; no retention or deletion path for patient data; the Supabase access token sits in plaintext in `.mcp.json` (gitignored).

## 9. Missing abstractions

1. **Customer** — identity separate from a thread of messages.
2. **Business knowledge** — data, not prose in a prompt.
3. **Tool/action layer** — a typed contract between the model and business operations, with recorded outcomes.
4. **Prompt assembly** — composable sections instead of one string.
5. **Event log** — one append-only trail for webhook, AI, tool and delivery events.
6. **Organization** — the tenant boundary every other table should hang from.
7. **Scheduler** — nothing can run later, which blocks all follow-up automation.

## 10. Recommended target architecture

```
Meta ──▶ /api/webhook ──▶ ingest (store, dedupe, ack fast)
                              │
                              ▼  after()
                    ┌── conversation engine ──────────────┐
                    │  prompt assembly                    │
                    │   ├ core system prompt              │
                    │   ├ business context (from DB)      │
                    │   ├ customer context (from DB)      │
                    │   ├ conversation history            │
                    │   ├ retrieved knowledge             │
                    │   └ tool definitions                │
                    │  model call (reply + metadata)      │
                    │  tool execution loop → tool_calls   │
                    │  escalation rules                   │
                    └──────────┬──────────────────────────┘
                               ▼
              agent: send · draft: hold · human: store only
                               │
                    events (append-only) ──▶ analytics + AI quality
```

Principles: business facts live in the database; the model's claims are backed by tool results; every step writes an event; each new table carries `organization_id` from the start even while only one organization exists.

## 11. Migration risks

| Risk | Mitigation |
|---|---|
| Backfilling customers from conversations could mis-merge two people sharing a number | One customer per distinct phone; no fuzzy merging |
| Dropping the `conversations.phone` unique constraint may allow accidental duplicate threads | Replace with unique `(organization_id, phone)` in the same migration |
| Extra model calls per message will blow the 50/day free cap | Single combined call for reply plus metadata; feature-flag intelligence |
| Tool calling requires a model that supports it; the current free model may not | Detect capability at startup, fall back to reply-only mode |
| No backups while migrations run | Take an export before each destructive migration (see the plan) |
| A long migration chain diverges from the deployed build | Every migration idempotent and backward compatible; deploy after each step |
