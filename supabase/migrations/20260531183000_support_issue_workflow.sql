alter table public.support_tickets
add column if not exists area text not null default 'general',
add column if not exists source text not null default 'user_report',
add column if not exists error_code text,
add column if not exists root_cause_category text not null default 'needs_triage',
add column if not exists root_cause text not null default 'Needs owner review.',
add column if not exists suggested_fix text not null default '',
add column if not exists fix_status text not null default 'not_started',
add column if not exists owner_notes text not null default '',
add column if not exists closed_reason text,
add column if not exists linked_error_event_id uuid references public.error_events(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'support_tickets_fix_status_check'
      and conrelid = 'public.support_tickets'::regclass
  ) then
    alter table public.support_tickets
    add constraint support_tickets_fix_status_check
    check (fix_status in ('not_started', 'investigating', 'needs_code_fix', 'fixed', 'wont_fix', 'user_action_required'));
  end if;
end $$;

create index if not exists support_tickets_area_status_idx
on public.support_tickets(area, status, updated_at desc);

create index if not exists support_tickets_root_cause_idx
on public.support_tickets(root_cause_category, fix_status);

drop policy if exists "admins can create support messages" on public.support_ticket_messages;
create policy "admins can create support messages"
on public.support_ticket_messages for insert
to authenticated
with check (public.is_admin());

drop policy if exists "admins can update support messages" on public.support_ticket_messages;
create policy "admins can update support messages"
on public.support_ticket_messages for update
to authenticated
using (public.is_admin())
with check (public.is_admin());
