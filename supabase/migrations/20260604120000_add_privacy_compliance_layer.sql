create table if not exists public.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_type text not null,
  status text not null default 'submitted',
  subject text,
  details text,
  identity_verification_status text not null default 'session_verified',
  due_at timestamptz,
  resolved_at timestamptz,
  resolution_summary text,
  admin_notes text,
  export_storage_path text,
  deletion_plan jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint privacy_requests_type_check check (
    request_type in ('access', 'export', 'deletion', 'correction', 'restriction', 'objection', 'ai_review')
  ),
  constraint privacy_requests_status_check check (
    status in ('submitted', 'in_review', 'waiting_for_user', 'approved', 'completed', 'rejected', 'cancelled')
  ),
  constraint privacy_requests_identity_check check (
    identity_verification_status in ('session_verified', 'pending', 'verified', 'failed')
  )
);

alter table public.profiles
add column if not exists privacy_policy_accepted_at timestamptz,
add column if not exists privacy_policy_version text;

create index if not exists privacy_requests_user_created_idx
on public.privacy_requests(user_id, created_at desc);

create index if not exists privacy_requests_status_due_idx
on public.privacy_requests(status, due_at);

create table if not exists public.security_incidents (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id),
  severity text not null,
  status text not null default 'open',
  title text not null,
  summary text,
  detected_at timestamptz not null default now(),
  contained_at timestamptz,
  resolved_at timestamptz,
  affected_user_count integer,
  affected_data_categories text[] not null default '{}',
  regulator_notification_required boolean,
  user_notification_required boolean,
  notification_deadline_at timestamptz,
  resolution_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint security_incidents_severity_check check (
    severity in ('low', 'medium', 'high', 'critical')
  ),
  constraint security_incidents_status_check check (
    status in ('open', 'investigating', 'contained', 'resolved', 'closed')
  ),
  constraint security_incidents_affected_user_count_check check (
    affected_user_count is null or affected_user_count >= 0
  )
);

create index if not exists security_incidents_status_detected_idx
on public.security_incidents(status, detected_at desc);

create trigger privacy_requests_set_updated_at
before update on public.privacy_requests
for each row execute function public.set_updated_at();

create trigger security_incidents_set_updated_at
before update on public.security_incidents
for each row execute function public.set_updated_at();

alter table public.privacy_requests enable row level security;
alter table public.security_incidents enable row level security;

drop policy if exists "users can create own privacy requests" on public.privacy_requests;
create policy "users can create own privacy requests"
on public.privacy_requests for insert
to authenticated
with check (
  auth.uid() = user_id
  and status = 'submitted'
  and identity_verification_status = 'session_verified'
  and resolved_at is null
  and resolution_summary is null
  and admin_notes is null
);

drop policy if exists "users can read own privacy requests" on public.privacy_requests;
create policy "users can read own privacy requests"
on public.privacy_requests for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "admins can read privacy requests" on public.privacy_requests;
create policy "admins can read privacy requests"
on public.privacy_requests for select
to authenticated
using (public.is_admin());

drop policy if exists "admins can update privacy requests" on public.privacy_requests;
create policy "admins can update privacy requests"
on public.privacy_requests for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "admins can manage security incidents" on public.security_incidents;
create policy "admins can manage security incidents"
on public.security_incidents for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('privacy-exports', 'privacy-exports', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "users can upload own privacy exports" on storage.objects;
create policy "users can upload own privacy exports"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'privacy-exports'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "users can read own privacy exports" on storage.objects;
create policy "users can read own privacy exports"
on storage.objects for select
to authenticated
using (
  bucket_id = 'privacy-exports'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "admins can read privacy exports" on storage.objects;
create policy "admins can read privacy exports"
on storage.objects for select
to authenticated
using (
  bucket_id = 'privacy-exports'
  and public.is_admin()
);
