-- Run this in the Supabase SQL Editor (or apply it as a migration via the Supabase MCP server).
-- Every statement is idempotent: it works on a fresh project and upgrades a database
-- that was created from the original schema.

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
-- The dashboard's browser client only uses the public anon key to receive Realtime
-- events, so anon gets read-only access and cannot insert, update or delete.
alter table conversations enable row level security;
alter table messages enable row level security;

drop policy if exists "Anon can read conversations" on conversations;
create policy "Anon can read conversations" on conversations for select to anon using (true);

drop policy if exists "Anon can read messages" on messages;
create policy "Anon can read messages" on messages for select to anon using (true);

-- Enable Realtime for the dashboard
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table conversations;
  end if;
end $$;
