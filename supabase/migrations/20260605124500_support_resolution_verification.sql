alter table public.support_tickets
add column if not exists resolution_verification text not null default '',
add column if not exists verified_at timestamptz;

create index if not exists support_tickets_verified_idx
on public.support_tickets(status, verified_at desc)
where verified_at is not null;

drop policy if exists "admins can resolve error events" on public.error_events;
create policy "admins can resolve error events"
on public.error_events for update
to authenticated
using (public.is_admin())
with check (public.is_admin());
