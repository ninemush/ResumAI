alter table public.job_ingestions
  add column if not exists archived_at timestamptz;

alter table public.applications
  add column if not exists archived_at timestamptz;

create index if not exists job_ingestions_user_archive_updated_idx
  on public.job_ingestions(user_id, archived_at, updated_at desc);

create index if not exists applications_user_archive_updated_idx
  on public.applications(user_id, archived_at, updated_at desc);
