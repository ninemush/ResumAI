alter table public.applications
  add column if not exists next_action text,
  add column if not exists follow_up_at timestamptz,
  add column if not exists contact_name text,
  add column if not exists contact_channel text,
  add column if not exists priority text not null default 'normal',
  add column if not exists notes text;

alter table public.applications
  drop constraint if exists applications_priority_check;

alter table public.applications
  add constraint applications_priority_check
  check (priority in ('low', 'normal', 'high'));

create index if not exists applications_user_follow_up_idx
  on public.applications(user_id, archived_at, follow_up_at, updated_at desc);
