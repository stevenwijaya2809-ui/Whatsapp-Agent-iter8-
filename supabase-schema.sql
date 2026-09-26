-- Run this in the Supabase SQL Editor (or apply it as a migration via the Supabase MCP server).
-- Every statement is idempotent: it works on a fresh project and upgrades a database
-- that was created from an earlier version of this schema.

create table if not exists conversations (
  id uuid default gen_random_uuid() primary key,
  phone text unique not null,
  name text,
  mode text not null default 'agent' check (mode in ('agent', 'human')),
  last_read_at timestamp with time zone,
  updated_at timestamp with time zone default now(),
  created_at timestamp with time zone default now()
);

create table if not exists messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references conversations(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  -- Who wrote an assistant message: the AI agent or a human from the dashboard (null for user messages)
  sent_by text check (sent_by in ('ai', 'human')),
  content text not null,
  whatsapp_msg_id text unique,
  created_at timestamp with time zone default now()
);

-- Columns added after the original schema
alter table conversations add column if not exists last_read_at timestamp with time zone;
alter table messages add column if not exists sent_by text check (sent_by in ('ai', 'human'));

create index if not exists idx_messages_conversation on messages(conversation_id);
create index if not exists idx_conversations_updated on conversations(updated_at desc);

-- Row Level Security. The server uses the service role key, which bypasses RLS.
-- No policies are defined for anyone else, so the public anon key cannot read or
-- write these tables: conversations are only reachable through the signed-in dashboard.
alter table conversations enable row level security;
alter table messages enable row level security;

-- The dashboard used to read these tables with the public anon key to receive Realtime
-- changes. It now listens for update pings the server sends over Realtime Broadcast and
-- reloads through its authenticated API, so that read access is revoked.
drop policy if exists "Anon can read conversations" on conversations;
drop policy if exists "Anon can read messages" on messages;

-- For the same reason the tables no longer need to stream changes to clients.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime drop table messages;
  end if;

  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime drop table conversations;
  end if;
end $$;
