alter type public.extraction_status add value if not exists 'saved';
alter type public.extraction_status add value if not exists 'uploaded';
alter type public.extraction_status add value if not exists 'extracting';
alter type public.extraction_status add value if not exists 'extracted';
alter type public.extraction_status add value if not exists 'analyzing';
alter type public.extraction_status add value if not exists 'analyzed';
alter type public.extraction_status add value if not exists 'analysis_failed';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'profile_source_analysis_status') then
    create type public.profile_source_analysis_status as enum (
      'pending',
      'analyzing',
      'analyzed',
      'analysis_failed',
      'deleted'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'career_profile_status') then
    create type public.career_profile_status as enum (
      'draft',
      'needs_review',
      'ready',
      'merge_failed',
      'deleted'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'credit_reservation_status') then
    create type public.credit_reservation_status as enum (
      'reserved',
      'finalized',
      'released',
      'expired'
    );
  end if;
end $$;

create table if not exists public.profile_source_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  source_id uuid not null references public.profile_sources(id) on delete cascade,
  schema_version text not null,
  prompt_version text not null,
  model text not null,
  status public.profile_source_analysis_status not null default 'pending',
  content_json jsonb not null default '{}'::jsonb,
  confidence numeric(4, 3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  warnings text[] not null default '{}',
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.career_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  schema_version text not null,
  version_number integer not null default 1 check (version_number > 0),
  content_json jsonb not null default '{}'::jsonb,
  merge_metadata jsonb not null default '{}'::jsonb,
  status public.career_profile_status not null default 'draft',
  last_source_analysis_id uuid references public.profile_source_analyses(id) on delete set null,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists career_profiles_one_current_per_profile_idx
on public.career_profiles(user_id, profile_id)
where is_current and status <> 'deleted';

create index if not exists profile_source_analyses_user_profile_idx
on public.profile_source_analyses(user_id, profile_id, created_at desc);

create index if not exists profile_source_analyses_source_idx
on public.profile_source_analyses(source_id, created_at desc);

create table if not exists public.credit_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null,
  amount integer not null check (amount > 0),
  resource_type text not null,
  resource_id uuid,
  idempotency_key text not null,
  status public.credit_reservation_status not null default 'reserved',
  ledger_event_id uuid references public.credit_ledger(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists credit_reservations_active_key_idx
on public.credit_reservations(user_id, idempotency_key)
where status in ('reserved', 'finalized');

create index if not exists credit_reservations_user_status_idx
on public.credit_reservations(user_id, status, expires_at);

alter table public.profile_sources
add column if not exists processing_started_at timestamptz,
add column if not exists upload_expires_at timestamptz;

alter table public.profile_facts
add column if not exists evidence_strength text,
add column if not exists source_type text,
add column if not exists source_label text,
add column if not exists role_context text,
add column if not exists employer_context text,
add column if not exists time_period text,
add column if not exists seniority_signal text,
add column if not exists impact_category text,
add column if not exists metric_type text,
add column if not exists safe_for_resume boolean not null default true,
add column if not exists inferred_vs_stated text not null default 'stated';

alter table public.job_ingestions
alter column job_url drop not null,
add column if not exists source_type text not null default 'url_fetch',
add column if not exists fit_snapshot_at_ingestion jsonb,
add column if not exists current_fit_analysis jsonb,
add column if not exists fit_decision text,
add column if not exists fit_decision_reason text,
add column if not exists fit_analysis_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'job_ingestions_source_type_check'
      and conrelid = 'public.job_ingestions'::regclass
  ) then
    alter table public.job_ingestions
    add constraint job_ingestions_source_type_check
    check (source_type in ('url_fetch', 'manual_paste', 'screenshot', 'file'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'job_ingestions_source_payload_check'
      and conrelid = 'public.job_ingestions'::regclass
  ) then
    alter table public.job_ingestions
    add constraint job_ingestions_source_payload_check
    check (
      (source_type = 'url_fetch' and job_url is not null)
      or (source_type <> 'url_fetch' and extracted_text is not null)
      or ingestion_status in ('pending', 'processing', 'failed', 'deleted')
    );
  end if;
end $$;

alter table public.applications
add column if not exists fit_decision text,
add column if not exists fit_decision_reason text,
add column if not exists resume_angle text,
add column if not exists networking_route text,
add column if not exists likely_blocker text,
add column if not exists why_apply text,
add column if not exists next_best_action text,
add column if not exists outcome_learning text;

alter table public.generated_resumes
add column if not exists version_number integer not null default 1 check (version_number > 0),
add column if not exists generation_reason text,
add column if not exists parent_artifact_id uuid references public.generated_resumes(id) on delete set null,
add column if not exists is_current boolean not null default true,
add column if not exists generation_basis jsonb not null default '{}'::jsonb;

alter table public.generated_cover_letters
add column if not exists version_number integer not null default 1 check (version_number > 0),
add column if not exists generation_reason text,
add column if not exists parent_artifact_id uuid references public.generated_cover_letters(id) on delete set null,
add column if not exists is_current boolean not null default true,
add column if not exists generation_basis jsonb not null default '{}'::jsonb;

create index if not exists generated_resumes_current_idx
on public.generated_resumes(user_id, profile_id, application_id, resume_type)
where is_current and status <> 'deleted';

create index if not exists generated_cover_letters_current_idx
on public.generated_cover_letters(user_id, application_id)
where is_current and status <> 'deleted';

create table if not exists public.admin_access_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  visibility_level text not null,
  access_reason text not null,
  resource_type text not null,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.sensitive_support_contexts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  support_ticket_id uuid references public.support_tickets(id) on delete cascade,
  consent_recorded_at timestamptz,
  context_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profile_source_analyses enable row level security;
alter table public.career_profiles enable row level security;
alter table public.credit_reservations enable row level security;
alter table public.admin_access_audit_events enable row level security;
alter table public.sensitive_support_contexts enable row level security;

drop policy if exists "users can manage own source analyses" on public.profile_source_analyses;
create policy "users can manage own source analyses"
on public.profile_source_analyses for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "admins can read source analyses" on public.profile_source_analyses;
create policy "admins can read source analyses"
on public.profile_source_analyses for select
to authenticated
using (public.is_admin());

drop policy if exists "users can manage own career profiles" on public.career_profiles;
create policy "users can manage own career profiles"
on public.career_profiles for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "admins can read career profiles" on public.career_profiles;
create policy "admins can read career profiles"
on public.career_profiles for select
to authenticated
using (public.is_admin());

drop policy if exists "users can read own credit reservations" on public.credit_reservations;
create policy "users can read own credit reservations"
on public.credit_reservations for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "admins can read credit reservations" on public.credit_reservations;
create policy "admins can read credit reservations"
on public.credit_reservations for select
to authenticated
using (public.is_admin());

drop policy if exists "admins can manage admin access audits" on public.admin_access_audit_events;
create policy "admins can manage admin access audits"
on public.admin_access_audit_events for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "admins can manage sensitive support contexts" on public.sensitive_support_contexts;
create policy "admins can manage sensitive support contexts"
on public.sensitive_support_contexts for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create trigger profile_source_analyses_set_updated_at
before update on public.profile_source_analyses
for each row execute function public.set_updated_at();

create trigger career_profiles_set_updated_at
before update on public.career_profiles
for each row execute function public.set_updated_at();

create trigger credit_reservations_set_updated_at
before update on public.credit_reservations
for each row execute function public.set_updated_at();

create trigger sensitive_support_contexts_set_updated_at
before update on public.sensitive_support_contexts
for each row execute function public.set_updated_at();

create or replace function public.reserve_credits(
  p_amount integer,
  p_feature text,
  p_resource_type text,
  p_resource_id uuid default null,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_expires_in_seconds integer default 1800
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_key text := nullif(left(trim(coalesce(p_idempotency_key, '')), 180), '');
  v_existing public.credit_reservations%rowtype;
  v_balance integer := 0;
  v_reserved integer := 0;
  v_reservation public.credit_reservations%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_CREDIT_AMOUNT';
  end if;

  if v_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 42));
  perform public.grant_signup_credits_if_missing(v_user_id);

  update public.credit_reservations
  set status = 'expired'
  where user_id = v_user_id
    and status = 'reserved'
    and expires_at <= now();

  select *
  into v_existing
  from public.credit_reservations
  where user_id = v_user_id
    and idempotency_key = v_key
    and status in ('reserved', 'finalized')
  order by created_at desc
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'reservationId', v_existing.id,
      'status', v_existing.status,
      'ledgerEventId', v_existing.ledger_event_id,
      'summary', public.get_credit_summary(v_user_id)
    );
  end if;

  select coalesce(sum(credit_delta), 0)
  into v_balance
  from public.credit_ledger
  where user_id = v_user_id;

  select coalesce(sum(amount), 0)
  into v_reserved
  from public.credit_reservations
  where user_id = v_user_id
    and status = 'reserved'
    and expires_at > now();

  if greatest(0, v_balance) - v_reserved < p_amount then
    raise exception 'CREDITS_EXHAUSTED';
  end if;

  insert into public.credit_reservations (
    user_id,
    feature,
    amount,
    resource_type,
    resource_id,
    idempotency_key,
    metadata,
    expires_at
  )
  values (
    v_user_id,
    p_feature,
    p_amount,
    p_resource_type,
    p_resource_id,
    v_key,
    coalesce(p_metadata, '{}'::jsonb),
    now() + make_interval(secs => greatest(coalesce(p_expires_in_seconds, 1800), 60))
  )
  returning * into v_reservation;

  return jsonb_build_object(
    'reservationId', v_reservation.id,
    'status', v_reservation.status,
    'ledgerEventId', v_reservation.ledger_event_id,
    'summary', public.get_credit_summary(v_user_id)
  );
end;
$$;

create or replace function public.finalize_credit_reservation(
  p_reservation_id uuid,
  p_resource_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_reservation public.credit_reservations%rowtype;
  v_ledger_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 42));

  select *
  into v_reservation
  from public.credit_reservations
  where id = p_reservation_id
    and user_id = v_user_id
  for update;

  if v_reservation.id is null then
    raise exception 'CREDIT_RESERVATION_NOT_FOUND';
  end if;

  if v_reservation.status = 'finalized' then
    return jsonb_build_object(
      'reservationId', v_reservation.id,
      'status', v_reservation.status,
      'ledgerEventId', v_reservation.ledger_event_id,
      'summary', public.get_credit_summary(v_user_id)
    );
  end if;

  if v_reservation.status <> 'reserved' then
    raise exception 'CREDIT_RESERVATION_NOT_FINALIZABLE';
  end if;

  insert into public.credit_ledger (
    user_id,
    event_type,
    credit_delta,
    resource_type,
    resource_id,
    operation_key,
    metadata
  )
  values (
    v_user_id,
    'feature_' || v_reservation.feature,
    -v_reservation.amount,
    v_reservation.resource_type,
    coalesce(p_resource_id, v_reservation.resource_id),
    v_reservation.idempotency_key,
    v_reservation.metadata ||
      coalesce(p_metadata, '{}'::jsonb) ||
      jsonb_build_object('reservation_id', v_reservation.id, 'operation_key', v_reservation.idempotency_key)
  )
  returning id into v_ledger_id;

  update public.credit_reservations
  set
    status = 'finalized',
    ledger_event_id = v_ledger_id,
    resource_id = coalesce(p_resource_id, resource_id),
    metadata = metadata || coalesce(p_metadata, '{}'::jsonb)
  where id = v_reservation.id
  returning * into v_reservation;

  return jsonb_build_object(
    'reservationId', v_reservation.id,
    'status', v_reservation.status,
    'ledgerEventId', v_reservation.ledger_event_id,
    'summary', public.get_credit_summary(v_user_id)
  );
end;
$$;

create or replace function public.release_credit_reservation(
  p_reservation_id uuid,
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_reservation public.credit_reservations%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
  into v_reservation
  from public.credit_reservations
  where id = p_reservation_id
    and user_id = v_user_id
  for update;

  if v_reservation.id is null then
    raise exception 'CREDIT_RESERVATION_NOT_FOUND';
  end if;

  if v_reservation.status = 'reserved' then
    update public.credit_reservations
    set
      status = 'released',
      metadata = metadata ||
        coalesce(p_metadata, '{}'::jsonb) ||
        jsonb_build_object('release_reason', coalesce(p_reason, 'operation_failed'))
    where id = v_reservation.id
    returning * into v_reservation;
  end if;

  return jsonb_build_object(
    'reservationId', v_reservation.id,
    'status', v_reservation.status,
    'ledgerEventId', v_reservation.ledger_event_id,
    'summary', public.get_credit_summary(v_user_id)
  );
end;
$$;

create or replace function public.cleanup_stale_profile_uploads()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  update public.profile_sources
  set
    extraction_status = 'deleted',
    failure_reason = 'STALE_UPLOAD_INTENT'
  where extraction_status in ('pending', 'saved')
    and upload_expires_at is not null
    and upload_expires_at < now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.create_application_from_job(
  p_job_ingestion_id uuid,
  p_decision text,
  p_decision_reason text default null,
  p_override_skip boolean default false,
  p_status public.application_status default 'draft'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_job public.job_ingestions%rowtype;
  v_profile_id uuid;
  v_application public.applications%rowtype;
  v_quota_event_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_decision not in ('apply', 'network_first', 'skip', 'save_for_later', 'needs_more_profile') then
    raise exception 'INVALID_APPLICATION_DECISION';
  end if;

  if p_decision = 'skip' and not coalesce(p_override_skip, false) then
    raise exception 'APPLICATION_SKIP_REQUIRES_OVERRIDE';
  end if;

  select *
  into v_job
  from public.job_ingestions
  where id = p_job_ingestion_id
    and user_id = v_user_id;

  if v_job.id is null then
    raise exception 'JOB_NOT_FOUND';
  end if;

  if v_job.ingestion_status <> 'succeeded' then
    raise exception 'JOB_NOT_READY';
  end if;

  select id
  into v_profile_id
  from public.profiles
  where user_id = v_user_id
  limit 1;

  if v_profile_id is null then
    insert into public.profiles(user_id)
    values (v_user_id)
    returning id into v_profile_id;
  end if;

  select *
  into v_application
  from public.applications
  where user_id = v_user_id
    and job_ingestion_id = v_job.id
  limit 1;

  if v_application.id is null then
    insert into public.applications (
      user_id,
      profile_id,
      company_name,
      job_title,
      job_url,
      job_ingestion_id,
      status,
      fit_decision,
      fit_decision_reason,
      resume_angle,
      networking_route,
      likely_blocker,
      why_apply,
      next_best_action
    )
    values (
      v_user_id,
      v_profile_id,
      coalesce(nullif(v_job.company, ''), 'Unknown company'),
      v_job.title,
      coalesce(v_job.resolved_url, v_job.job_url, 'manual job description'),
      v_job.id,
      p_status,
      p_decision,
      p_decision_reason,
      v_job.current_fit_analysis ->> 'resumeAngle',
      case when p_decision = 'network_first' then v_job.current_fit_analysis ->> 'nextBestAction' else null end,
      v_job.current_fit_analysis ->> 'likelyScreeningRisk',
      v_job.current_fit_analysis ->> 'recommendation',
      v_job.current_fit_analysis ->> 'nextBestAction'
    )
    returning * into v_application;

    insert into public.quota_events (
      user_id,
      event_type,
      resource_type,
      resource_id,
      amount,
      period_start,
      period_end,
      metadata
    )
    values (
      v_user_id,
      'application_logged',
      'application',
      v_application.id,
      1,
      date_trunc('month', now()),
      date_trunc('month', now()) + interval '1 month',
      jsonb_build_object(
        'job_ingestion_id', v_job.id,
        'fit_decision', p_decision,
        'decision_reason', p_decision_reason
      )
    )
    returning id into v_quota_event_id;

    update public.applications
    set quota_event_id = v_quota_event_id
    where id = v_application.id
    returning * into v_application;

    insert into public.application_status_events (
      user_id,
      application_id,
      previous_status,
      new_status,
      source,
      metadata
    )
    values (
      v_user_id,
      v_application.id,
      null,
      v_application.status,
      'system',
      jsonb_build_object('created_from_job', true, 'fit_decision', p_decision)
    );

    insert into public.audit_events (
      user_id,
      actor_user_id,
      event_type,
      resource_type,
      resource_id,
      metadata
    )
    values (
      v_user_id,
      v_user_id,
      'application.created_from_job',
      'application',
      v_application.id,
      jsonb_build_object('job_ingestion_id', v_job.id, 'fit_decision', p_decision)
    );
  end if;

  return jsonb_build_object(
    'id', v_application.id,
    'companyName', v_application.company_name,
    'jobTitle', v_application.job_title,
    'jobUrl', v_application.job_url,
    'status', v_application.status,
    'fitDecision', v_application.fit_decision,
    'fitDecisionReason', v_application.fit_decision_reason,
    'created', v_quota_event_id is not null
  );
end;
$$;

create or replace function public.create_support_issue_with_messages(
  p_area text,
  p_error_code text,
  p_escalated_to_l2 boolean,
  p_escalation_reason text,
  p_fix_status text,
  p_l1_disposition text,
  p_metadata jsonb,
  p_priority text,
  p_root_cause text,
  p_root_cause_category text,
  p_sentiment text,
  p_source text,
  p_status text,
  p_subject text,
  p_suggested_fix text,
  p_summary text,
  p_user_message text default null,
  p_system_message text default null,
  p_sensitive_context jsonb default null,
  p_existing_ticket_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_error_event_id uuid;
  v_ticket public.support_tickets%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_existing_ticket_id is not null then
    select *
    into v_ticket
    from public.support_tickets
    where id = p_existing_ticket_id
      and user_id = v_user_id
    for update;

    if v_ticket.id is null then
      raise exception 'SUPPORT_TICKET_NOT_FOUND';
    end if;

    update public.support_tickets
    set
      updated_at = now(),
      metadata = metadata ||
        jsonb_build_object(
          'lastDuplicateAt', now(),
          'supportContextIncluded', coalesce((p_sensitive_context is not null and p_sensitive_context <> '{}'::jsonb), false)
        )
    where id = v_ticket.id
    returning * into v_ticket;
  else
    insert into public.error_events (
      area,
      error_code,
      fix_required,
      message,
      metadata,
      rationale,
      root_cause_category,
      severity,
      user_id
    )
    values (
      coalesce(nullif(p_area, ''), 'general'),
      coalesce(nullif(p_error_code, ''), 'USER_REPORTED_ISSUE'),
      p_fix_status = 'needs_code_fix',
      coalesce(nullif(p_user_message, ''), nullif(p_system_message, ''), p_summary, p_subject, 'Support issue created.'),
      coalesce(p_metadata, '{}'::jsonb),
      coalesce(p_root_cause, ''),
      coalesce(nullif(p_root_cause_category, ''), 'needs_triage'),
      case
        when p_priority = 'urgent' then 'critical'
        when p_priority = 'high' then 'high'
        when p_priority = 'low' then 'low'
        else 'medium'
      end,
      v_user_id
    )
    returning id into v_error_event_id;

    insert into public.support_tickets (
      area,
      error_code,
      escalated_to_l2,
      escalation_reason,
      fix_status,
      linked_error_event_id,
      l1_disposition,
      metadata,
      priority,
      root_cause,
      root_cause_category,
      sentiment,
      source,
      status,
      subject,
      suggested_fix,
      summary,
      user_id
    )
    values (
      coalesce(nullif(p_area, ''), 'general'),
      coalesce(nullif(p_error_code, ''), 'USER_REPORTED_ISSUE'),
      coalesce(p_escalated_to_l2, false),
      p_escalation_reason,
      coalesce(nullif(p_fix_status, ''), 'investigating'),
      v_error_event_id,
      coalesce(nullif(p_l1_disposition, ''), 'intake_packet_prepared'),
      coalesce(p_metadata, '{}'::jsonb),
      coalesce(nullif(p_priority, ''), 'normal'),
      coalesce(p_root_cause, ''),
      coalesce(nullif(p_root_cause_category, ''), 'needs_triage'),
      coalesce(nullif(p_sentiment, ''), 'neutral'),
      coalesce(nullif(p_source, ''), 'user_report'),
      coalesce(nullif(p_status, ''), 'open'),
      coalesce(nullif(p_subject, ''), 'Support issue'),
      coalesce(p_suggested_fix, ''),
      coalesce(p_summary, ''),
      v_user_id
    )
    returning * into v_ticket;
  end if;

  if nullif(trim(coalesce(p_user_message, '')), '') is not null then
    insert into public.support_ticket_messages (
      message,
      metadata,
      speaker,
      ticket_id,
      user_id
    )
    values (
      p_user_message,
      jsonb_build_object('source', 'support_issue_transaction'),
      'user',
      v_ticket.id,
      v_user_id
    );
  end if;

  if nullif(trim(coalesce(p_system_message, '')), '') is not null then
    insert into public.support_ticket_messages (
      message,
      metadata,
      speaker,
      ticket_id,
      user_id
    )
    values (
      p_system_message,
      jsonb_build_object(
        'source', 'support_issue_transaction',
        'contextStoredSeparately', coalesce((p_sensitive_context is not null and p_sensitive_context <> '{}'::jsonb), false)
      ),
      'system',
      v_ticket.id,
      v_user_id
    );
  end if;

  if p_sensitive_context is not null and p_sensitive_context <> '{}'::jsonb then
    insert into public.sensitive_support_contexts (
      user_id,
      support_ticket_id,
      consent_recorded_at,
      context_json
    )
    values (
      v_user_id,
      v_ticket.id,
      now(),
      p_sensitive_context
    );
  end if;

  return jsonb_build_object(
    'id', v_ticket.id,
    'shortId', 'PR-' || upper(left(v_ticket.id::text, 8)),
    'status', v_ticket.status,
    'subject', v_ticket.subject,
    'summary', v_ticket.summary,
    'created', p_existing_ticket_id is null
  );
end;
$$;

revoke all on function public.reserve_credits(integer, text, text, uuid, text, jsonb, integer) from public;
revoke all on function public.finalize_credit_reservation(uuid, uuid, jsonb) from public;
revoke all on function public.release_credit_reservation(uuid, text, jsonb) from public;
revoke all on function public.cleanup_stale_profile_uploads() from public;
revoke all on function public.create_application_from_job(uuid, text, text, boolean, public.application_status) from public;
revoke all on function public.create_support_issue_with_messages(text, text, boolean, text, text, text, jsonb, text, text, text, text, text, text, text, text, text, text, text, jsonb, uuid) from public;

grant execute on function public.reserve_credits(integer, text, text, uuid, text, jsonb, integer) to authenticated;
grant execute on function public.finalize_credit_reservation(uuid, uuid, jsonb) to authenticated;
grant execute on function public.release_credit_reservation(uuid, text, jsonb) to authenticated;
grant execute on function public.cleanup_stale_profile_uploads() to authenticated, service_role;
grant execute on function public.create_application_from_job(uuid, text, text, boolean, public.application_status) to authenticated;
grant execute on function public.create_support_issue_with_messages(text, text, boolean, text, text, text, jsonb, text, text, text, text, text, text, text, text, text, text, text, jsonb, uuid) to authenticated;
