create extension if not exists pgcrypto;

create type public.admin_role as enum ('owner', 'admin');
create type public.profile_status as enum ('draft', 'needs_review', 'ready');
create type public.profile_source_type as enum (
  'natural_language',
  'pdf',
  'docx',
  'txt',
  'image',
  'link',
  'linkedin',
  'portfolio',
  'other'
);
create type public.extraction_status as enum ('pending', 'processing', 'succeeded', 'failed', 'deleted');
create type public.profile_fact_type as enum (
  'experience',
  'credential',
  'education',
  'skill',
  'accolade',
  'project',
  'industry',
  'preference',
  'other'
);
create type public.fact_origin as enum ('user_provided', 'imported', 'inferred', 'confirmed');
create type public.resume_type as enum ('master', 'application');
create type public.artifact_status as enum ('draft', 'ready', 'archived', 'deleted');
create type public.job_ingestion_status as enum ('pending', 'processing', 'succeeded', 'failed', 'deleted');
create type public.application_status as enum (
  'draft',
  'applied',
  'no_reply',
  'rejected',
  'interview_in_progress',
  'interviewed_not_selected',
  'interviewed_selected',
  'withdrawn'
);
create type public.user_tier_status as enum ('active', 'paused', 'cancelled', 'expired');
create type public.quota_event_type as enum ('application_logged', 'generation_created', 'manual_adjustment');

create table public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.admin_role not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (user_id, role)
);

create table public.tiers (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text not null default '',
  application_limit integer not null check (application_limit >= 0),
  generation_limit integer not null check (generation_limit >= 0),
  period_days integer not null default 30 check (period_days > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_tiers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tier_id uuid not null references public.tiers(id),
  status public.user_tier_status not null default 'active',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text,
  headline text,
  summary text,
  target_direction text,
  target_level text,
  profile_status public.profile_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table public.profile_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  source_type public.profile_source_type not null,
  source_url text,
  storage_path text,
  original_filename text,
  mime_type text,
  extracted_text text,
  extraction_status public.extraction_status not null default 'pending',
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_url is not null or storage_path is not null or extracted_text is not null)
);

create table public.profile_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  fact_type public.profile_fact_type not null,
  fact_value text not null,
  origin public.fact_origin not null,
  source_ids uuid[] not null default '{}',
  confidence numeric(4, 3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  user_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.role_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_family text not null,
  role_titles text[] not null default '{}',
  seniority_level text,
  rationale text not null default '',
  assumptions text[] not null default '{}',
  open_questions text[] not null default '{}',
  confidence numeric(4, 3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  user_acknowledged boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.job_ingestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_url text not null,
  resolved_url text,
  title text,
  company text,
  extracted_text text,
  ingestion_status public.job_ingestion_status not null default 'pending',
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quota_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  tier_id uuid references public.tiers(id) on delete set null,
  event_type public.quota_event_type not null,
  resource_type text not null,
  resource_id uuid,
  amount integer not null default 1 check (amount > 0),
  period_start timestamptz not null,
  period_end timestamptz not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  company_name text not null,
  job_title text,
  job_url text not null,
  job_ingestion_id uuid references public.job_ingestions(id) on delete set null,
  status public.application_status not null default 'draft',
  quota_event_id uuid references public.quota_events(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.generated_resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  application_id uuid references public.applications(id) on delete restrict,
  resume_type public.resume_type not null,
  prompt_version text,
  model text,
  content_json jsonb not null default '{}',
  storage_path text,
  pdf_storage_path text,
  status public.artifact_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.generated_cover_letters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete restrict,
  prompt_version text,
  model text,
  content text not null default '',
  pdf_storage_path text,
  status public.artifact_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  resource_type text not null,
  resource_id uuid,
  request_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index admin_roles_user_id_idx on public.admin_roles(user_id);
create index user_tiers_user_id_idx on public.user_tiers(user_id);
create index profiles_user_id_idx on public.profiles(user_id);
create index profile_sources_user_id_idx on public.profile_sources(user_id);
create index profile_facts_user_id_idx on public.profile_facts(user_id);
create index role_recommendations_user_id_idx on public.role_recommendations(user_id);
create index job_ingestions_user_id_idx on public.job_ingestions(user_id);
create index quota_events_user_id_idx on public.quota_events(user_id);
create index applications_user_id_idx on public.applications(user_id);
create index generated_resumes_user_id_idx on public.generated_resumes(user_id);
create index generated_cover_letters_user_id_idx on public.generated_cover_letters(user_id);
create index audit_events_user_id_idx on public.audit_events(user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_roles
    where user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

create trigger tiers_set_updated_at
before update on public.tiers
for each row execute function public.set_updated_at();

create trigger user_tiers_set_updated_at
before update on public.user_tiers
for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger profile_sources_set_updated_at
before update on public.profile_sources
for each row execute function public.set_updated_at();

create trigger profile_facts_set_updated_at
before update on public.profile_facts
for each row execute function public.set_updated_at();

create trigger role_recommendations_set_updated_at
before update on public.role_recommendations
for each row execute function public.set_updated_at();

create trigger job_ingestions_set_updated_at
before update on public.job_ingestions
for each row execute function public.set_updated_at();

create trigger applications_set_updated_at
before update on public.applications
for each row execute function public.set_updated_at();

create trigger generated_resumes_set_updated_at
before update on public.generated_resumes
for each row execute function public.set_updated_at();

create trigger generated_cover_letters_set_updated_at
before update on public.generated_cover_letters
for each row execute function public.set_updated_at();

alter table public.admin_roles enable row level security;
alter table public.tiers enable row level security;
alter table public.user_tiers enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_sources enable row level security;
alter table public.profile_facts enable row level security;
alter table public.role_recommendations enable row level security;
alter table public.job_ingestions enable row level security;
alter table public.quota_events enable row level security;
alter table public.applications enable row level security;
alter table public.generated_resumes enable row level security;
alter table public.generated_cover_letters enable row level security;
alter table public.audit_events enable row level security;

create policy "admins can read admin roles"
on public.admin_roles for select
to authenticated
using (public.is_admin());

create policy "admins can manage admin roles"
on public.admin_roles for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "users can read active tiers"
on public.tiers for select
to authenticated
using (is_active = true or public.is_admin());

create policy "admins can manage tiers"
on public.tiers for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "users can read own tier assignments"
on public.user_tiers for select
to authenticated
using (auth.uid() = user_id or public.is_admin());

create policy "admins can manage tier assignments"
on public.user_tiers for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "users can manage own profiles"
on public.profiles for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "users can manage own profile sources"
on public.profile_sources for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "users can manage own profile facts"
on public.profile_facts for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "users can manage own role recommendations"
on public.role_recommendations for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "users can manage own job ingestions"
on public.job_ingestions for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "users can read own quota events"
on public.quota_events for select
to authenticated
using (auth.uid() = user_id or public.is_admin());

create policy "admins can insert quota events"
on public.quota_events for insert
to authenticated
with check (public.is_admin());

create policy "users can read own applications"
on public.applications for select
to authenticated
using (auth.uid() = user_id or public.is_admin());

create policy "users can insert own applications"
on public.applications for insert
to authenticated
with check (auth.uid() = user_id);

create policy "users can update own application status"
on public.applications for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "users can manage own generated resumes"
on public.generated_resumes for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "users can manage own generated cover letters"
on public.generated_cover_letters for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "users can read own audit events"
on public.audit_events for select
to authenticated
using (auth.uid() = user_id or public.is_admin());

create policy "admins can insert audit events"
on public.audit_events for insert
to authenticated
with check (public.is_admin());

insert into public.tiers (key, name, description, application_limit, generation_limit, period_days)
values
  ('starter', 'Starter', 'Launch placeholder tier. Final limits require approval before release.', 5, 25, 30),
  ('growth', 'Growth', 'Launch placeholder tier. Final limits require approval before release.', 25, 100, 30),
  ('pro', 'Pro', 'Launch placeholder tier. Final limits require approval before release.', 75, 300, 30)
on conflict (key) do nothing;

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('profile-sources', 'profile-sources', false, 52428800),
  ('generated-artifacts', 'generated-artifacts', false, 52428800)
on conflict (id) do nothing;

create policy "users can upload own profile sources"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'profile-sources'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "users can read own profile sources"
on storage.objects for select
to authenticated
using (
  bucket_id = 'profile-sources'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "users can update own profile sources"
on storage.objects for update
to authenticated
using (
  bucket_id = 'profile-sources'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'profile-sources'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "users can delete own profile sources"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'profile-sources'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "users can upload own generated artifacts"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'generated-artifacts'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "users can read own generated artifacts"
on storage.objects for select
to authenticated
using (
  bucket_id = 'generated-artifacts'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "users can update own generated artifacts"
on storage.objects for update
to authenticated
using (
  bucket_id = 'generated-artifacts'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'generated-artifacts'
  and (storage.foldername(name))[1] = auth.uid()::text
);

