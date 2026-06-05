alter table public.support_tickets
add column if not exists user_visible_resolution text not null default '',
add column if not exists reopen_until timestamptz,
add column if not exists auto_closed_at timestamptz;

create index if not exists support_tickets_reopen_window_idx
on public.support_tickets(status, reopen_until)
where reopen_until is not null;
