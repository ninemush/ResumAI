create type public.conversation_speaker as enum ('assistant', 'user', 'system');

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  speaker public.conversation_speaker not null,
  message_text text not null check (char_length(message_text) > 0 and char_length(message_text) <= 4000),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index conversation_messages_user_created_idx
on public.conversation_messages(user_id, created_at desc);

alter table public.conversation_messages enable row level security;

create policy "users can read own conversation messages"
on public.conversation_messages for select
to authenticated
using (auth.uid() = user_id);

create policy "users can insert own conversation messages"
on public.conversation_messages for insert
to authenticated
with check (auth.uid() = user_id);

create policy "users can delete own conversation messages"
on public.conversation_messages for delete
to authenticated
using (auth.uid() = user_id);
