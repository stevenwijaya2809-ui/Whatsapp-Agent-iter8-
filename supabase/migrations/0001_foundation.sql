-- P0.1 Foundation: an organization, real customers, and the tables the AI layer writes to.
-- Idempotent and additive: existing columns and behaviour are untouched, so the deployed
-- app keeps working before its code is updated.

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Asia/Jakarta',
  -- Business profile and AI settings live here so they can change without a deploy
  settings jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- One organization for now. Multi-tenancy later adds rows rather than changing shape.
insert into organizations (id, name, timezone)
values ('00000000-0000-0000-0000-000000000001', 'Senyum Dental Studio', 'Asia/Jakarta')
on conflict (id) do nothing;

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  phone text not null,
  name text,
  status text not null default 'NEW'
    check (status in ('NEW', 'LEAD', 'QUALIFIED', 'BOOKED', 'ACTIVE_CUSTOMER', 'RETURNING_CUSTOMER', 'INACTIVE')),
  lead_status text check (lead_status in ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST')),
  tags text[] not null default '{}',
  preferences jsonb not null default '{}'::jsonb,
  -- Short rolling summary the AI keeps, so history need not be replayed in full
  ai_summary text,
  first_contact_at timestamp with time zone not null default now(),
  last_interaction_at timestamp with time zone,
  conversation_count integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (organization_id, phone)
);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  author text not null default 'human' check (author in ('human', 'ai')),
  body text not null,
  created_at timestamp with time zone not null default now()
);

-- Append-only operational trail. Never store message content here.
create table if not exists events (
  id bigserial primary key,
  organization_id uuid references organizations(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  type text not null,
  status text not null default 'ok' check (status in ('ok', 'failed')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now()
);

create table if not exists kb_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  category text not null,
  question text not null,
  answer text not null,
  tags text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- 'simple' rather than 'english': these answers mix Indonesian and English, and wrong-language
-- stemming is worse than none. The config is cast to regconfig because a generated column
-- requires an immutable expression; tags stay searchable as an array rather than in the vector.
alter table kb_entries add column if not exists search tsvector
  generated always as (
    to_tsvector('simple'::regconfig, coalesce(question, '') || ' ' || coalesce(answer, ''))
  ) stored;

create table if not exists tool_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  tool text not null,
  arguments jsonb not null default '{}'::jsonb,
  result jsonb,
  status text not null check (status in ('ok', 'failed')),
  error text,
  duration_ms integer,
  created_at timestamp with time zone not null default now()
);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  service text not null,
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone not null,
  status text not null default 'booked'
    check (status in ('requested', 'booked', 'rescheduled', 'cancelled', 'completed', 'no_show')),
  created_by text not null default 'ai' check (created_by in ('ai', 'human')),
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- One row per analysed customer message, for AI quality reporting over time
create table if not exists message_analysis (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  intent text,
  sub_intent text,
  sentiment text,
  urgency text,
  confidence numeric,
  created_at timestamp with time zone not null default now(),
  unique (message_id)
);

-- Conversation gains ownership and the intelligence fields.
-- conversations.phone stays for now: the webhook still upserts by phone.
alter table conversations add column if not exists organization_id uuid references organizations(id) on delete cascade;
alter table conversations add column if not exists customer_id uuid references customers(id) on delete cascade;
alter table conversations add column if not exists intent text;
alter table conversations add column if not exists sub_intent text;
alter table conversations add column if not exists sentiment text;
alter table conversations add column if not exists urgency text;
alter table conversations add column if not exists ai_confidence numeric;
alter table conversations add column if not exists needs_human boolean not null default false;
alter table conversations add column if not exists escalation_reason text;
alter table conversations add column if not exists escalation_summary text;
alter table conversations add column if not exists escalated_at timestamp with time zone;
alter table conversations add column if not exists resolved_at timestamp with time zone;

-- Backfill: one customer per existing phone number, no fuzzy merging.
insert into customers (organization_id, phone, name, first_contact_at, last_interaction_at, conversation_count)
select
  '00000000-0000-0000-0000-000000000001',
  c.phone,
  max(c.name),
  coalesce(min(m.created_at), min(c.created_at)),
  coalesce(max(m.created_at), max(c.updated_at)),
  count(distinct c.id)
from conversations c
left join messages m on m.conversation_id = c.id
group by c.phone
on conflict (organization_id, phone) do nothing;

update conversations c
set organization_id = '00000000-0000-0000-0000-000000000001',
    customer_id = cu.id
from customers cu
where cu.organization_id = '00000000-0000-0000-0000-000000000001'
  and cu.phone = c.phone
  and (c.customer_id is null or c.organization_id is null);

create index if not exists idx_customers_org_phone on customers(organization_id, phone);
create index if not exists idx_conversations_attention on conversations(organization_id, needs_human, updated_at desc);
create index if not exists idx_conversations_customer on conversations(customer_id);
create index if not exists idx_notes_customer on notes(customer_id, created_at desc);
create index if not exists idx_events_conversation on events(conversation_id, created_at desc);
create index if not exists idx_events_type on events(type, created_at desc);
create index if not exists idx_kb_search on kb_entries using gin (search);
create index if not exists idx_tool_calls_conversation on tool_calls(conversation_id, created_at desc);
create index if not exists idx_appointments_schedule on appointments(organization_id, starts_at);
create index if not exists idx_appointments_customer on appointments(customer_id, starts_at desc);

-- Same posture as the existing tables: the service role reaches them, nobody else.
alter table organizations enable row level security;
alter table customers enable row level security;
alter table notes enable row level security;
alter table events enable row level security;
alter table kb_entries enable row level security;
alter table tool_calls enable row level security;
alter table appointments enable row level security;
alter table message_analysis enable row level security;
