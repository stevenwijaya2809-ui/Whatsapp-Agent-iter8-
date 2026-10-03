# AI upgrade — what changed

**Date:** 27 September 2026
**Scope:** P0.0 – P0.6 of [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)
**Commits:** `fd3322c`, `201e28a`, `3c12488`, `9eae214`, `b0e1626`

The starting point was a WhatsApp auto-responder: a webhook that stored a message, asked a model
for a reply and sent it back, with a dashboard to watch it happen. Business facts lived in a string
constant in the prompt. Nothing was recorded about what a customer wanted, nothing could be acted
on, and the only way to know a conversation had gone wrong was to read it.

It is now a system that understands each message, can act on it, knows when to stop and fetch a
person, and presents all of that to an operator as work to be done. The pieces below shipped in
five deployable steps, each verified before the next began.

---

## What shipped

### Foundation — customer records, a knowledge base, composable prompts (`fd3322c`)

**Schema** (`supabase/migrations/0001_foundation.sql`, `0002_seed_knowledge.sql`): `organizations`,
`customers`, `notes`, `events`, `kb_entries`, `tool_calls`, `appointments`, `message_analysis`, plus
the intelligence columns on `conversations` (`intent`, `sentiment`, `urgency`, `ai_confidence`,
`needs_human`, `escalation_reason`, `escalation_summary`, `escalated_at`, `resolved_at`). Existing
conversations were backfilled with customer records. Every table carries `organization_id`, so
multi-tenancy is a query change rather than a migration. Row-level security is on with no policies:
only the service role reaches the data, never the browser.

**Business facts moved out of the code.** Opening hours, prices, address and services are rows in
`kb_entries` and JSON in `organizations.settings`, retrieved per message by full-text search
(`websearch_to_tsquery` over a generated `tsvector`). Changing a price is now a database edit, not a
deploy. When nothing matches, the prompt says so explicitly and instructs the assistant to defer
rather than invent — the failure mode that matters most in a clinic.

**The prompt is assembled, not written.** `src/lib/ai/prompt/` composes core rules, business context,
customer context, retrieved knowledge, available actions and hand-over rules in a fixed order, so a
change to one section cannot silently disturb another.

### Conversation intelligence (`201e28a`)

Every reply now comes back as structured JSON: the message to send plus intent, sub-intent,
sentiment, urgency, a confidence score, and whether a person is needed. This is **one model call**,
not two — the analysis rides along with the reply, so understanding every conversation costs nothing
extra. That mattered: the free model allows 50 requests a day.

The parser (`src/lib/ai/analysis.ts`) is deliberately forgiving — code fences, prose around the JSON,
`0.94` or `"94%"` — and when the model ignores the contract entirely, the reply is still sent and the
analysis is simply absent. An analytics feature must never cost a customer their answer.

Readings are stored twice: the latest on the conversation, for the inbox; and per message in
`message_analysis`, for quality reporting later.

### The assistant can act (`3c12488`)

A tool layer (`src/lib/ai/tools/`) with six actions: check availability, book, reschedule, cancel,
list appointments, hand to a human. The engine runs at most two tool rounds per reply, feeds the
real result back into the conversation, and every attempt — success or failure — is recorded in
`tool_calls`.

**The server, not the model, decides what is possible.** A booking is rejected if it is in the past,
outside opening hours, on a closed day, would run past closing, or clashes with another appointment.
Treatment durations come from the service name, longest match winning, so a "cleaning and check-up"
is never under-booked. The prompt forbids claiming an action that no tool performed, and a failed
tool hands the conversation to a person rather than apologising in prose.

Set `AI_TOOLS=off` to keep the assistant answering but unable to act.

### Hand-over that does not depend on the model's judgement (`9eae214`)

`src/lib/ai/escalation.ts` decides in code, first match winning: an action that failed; the
assistant's own hand-over tool (keeping the reason it gave); the customer asking for a person; a
complaint; urgency; a payment problem; two uncertain answers in a row; an answer well below the
confidence threshold; a question nothing in the knowledge base could answer.

Every hand-over is recorded with a reason and a **briefing** assembled from the record — who the
customer is, what they seem to want, what is in their diary, and the last few messages including the
reply just sent. It is built from facts rather than written by the model, so it cannot invent an
appointment that does not exist.

Hard reasons also stop the assistant replying — but only *after* the customer has been told a
colleague is coming, and never against an operator's own choice of mode. The dashboard shows the
reason and briefing above the conversation, and **Mark handled** closes it, which is what records it
as resolved.

### The inbox and the customer beside the chat (`b0e1626`)

The conversation list answers the questions an operator actually asks: **Needs a person**,
**Unanswered**, **Drafts to approve**, **Bookings**, **Complaints**, **New leads**, **AI handled** —
each with a live count, with search over names, numbers and message text, and sorting by most
recent, longest waiting or most urgent.

The three queues of work are deliberately disjoint, so nothing is counted twice: a conversation the
assistant handed over is in **Needs a person** (with its reason and briefing); one nobody has
replied to and nobody flagged is **Unanswered** — which is what catches the assistant failing
silently, such as the free model's daily cap running out; and a reply already written and waiting
for approval is **Drafts to approve**. Together the first two are what the results page counts as
"Awaiting your reply" for its period. Conversations left waiting more than half an hour say how long, and turn orange past four.

A panel beside the chat shows the customer: status, tags, first contact, message count, upcoming and
past appointments, and notes — plus the three things an operator does from there (set the status,
add a tag, write a note). It is always open on wide screens and opens over the chat on narrow ones.

---

## New surfaces

| Route | Purpose |
|---|---|
| `GET /api/conversations/[id]/context` | Customer, appointments, notes and message count for the panel |
| `POST /api/conversations/[id]/notes` | Add an operator note |
| `PATCH /api/customers/[id]` | Set the customer status, add a tag |
| `PATCH /api/conversations/[id]` | Now also accepts `{ "resolve": true }` to close a hand-over |

## Settings, not code

`organizations.settings` holds the business profile (name, address, phone, hours) and AI settings
(`personality`, `confidenceThreshold`, `escalateOnComplaint`). They are read fresh at most every
60 seconds, so an edit takes effect without a deploy.

---

## How it was verified

`npm run verify` — type-check, lint, **110 unit tests** across 10 files: webhook parsing and
signatures, the webhook route's ordering (escalate before the analysis overwrites the previous
confidence; pause only after the reply is sent), reply parsing, prompt assembly, availability,
booking rules, escalation rules, the hand-over briefing, and the inbox filters, sorting and search.

End-to-end scripts in `scripts/e2e/`, run against a live server, the real model and the real
database (they clean up after themselves and use draft mode, so nothing reaches WhatsApp):

| Script | What it proves |
|---|---|
| `knowledge-reply.mjs` | Answers come from the knowledge base, not the model's imagination |
| `intelligence.mjs` | Intent, sentiment and confidence are detected and stored |
| `booking.mjs` | A real appointment is created; an impossible one is refused and nothing is written |
| `escalation.mjs` | An ordinary question is answered; a complaint is handed over with a briefing; the operator's mode is untouched; the dashboard closes it |
| `customer-context.mjs` | The panel's reads and its three write actions |

Plus a production build, and P0.4 verified against production WhatsApp: the assistant booked a real
appointment at 10:00 Jakarta and refused a 3am request, offering genuinely free times instead.

---

## Deliberately not done

- **Google Calendar sync** — parked at your request. Appointments live in `appointments`; a calendar
  is an adapter behind the same tool interface, and wants a `staff` table first so a booking belongs
  to a named doctor.
- **Payments, WhatsApp templates, campaigns** — later phases; the free tier is what the pitch runs on.
- **Multi-tenancy** — the columns exist, the queries still assume one organization.
- **Manual appointment creation from the dashboard** — the assistant can book; an operator cannot yet,
  except by talking to the customer.

## Known limits

- **The free model allows 50 requests a day** and may train on prompts. Fine for demos, not for a
  paying clinic — top up OpenRouter credit and move to a paid model before selling this.
- **No database backups on the Supabase free plan.** `scripts/export-data.mjs` writes a JSON export
  to `backups/` (gitignored — it contains patient messages). Run it before any schema change.
- **One shared dashboard password**, no per-user accounts, so there is no audit trail of who did what.
- **`ai.afterHoursReply` is seeded but not enforced** — the assistant answers at any hour.
- **Appointments have no staff column**, so the diary is the clinic's, not a particular doctor's.
- **The five conversations that predate this work** show no intent, sentiment or confidence until
  their next message — nothing analysed them retrospectively. They do have customer records, from
  the backfill, so the customer panel works on them.
- **Vercel Hobby is non-commercial.** Selling this means a Pro plan.

## What is next

P1, in the order it is worth doing: the analytics upgrade (the data is already being collected),
follow-up automation (needs a `scheduled_jobs` table and a cron route — `after()` cannot run work
hours later), and an AI quality centre built on `message_analysis` and `tool_calls`. The calendar
loop resumes whenever you want it.
