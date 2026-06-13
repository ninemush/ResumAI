create table if not exists public.quota_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  tier_id uuid references public.tiers(id) on delete set null,
  event_type public.quota_event_type not null,
  resource_type text not null,
  resource_id uuid,
  amount integer not null default 1 check (amount > 0),
  operation_key text not null,
  status text not null default 'reserved' check (status in ('reserved', 'finalized', 'released', 'expired')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  metadata jsonb not null default '{}',
  quota_event_id uuid references public.quota_events(id) on delete restrict,
  release_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz,
  released_at timestamptz
);

create unique index if not exists quota_reservations_user_event_operation_key_idx
on public.quota_reservations(user_id, event_type, operation_key);

create index if not exists quota_reservations_user_status_period_idx
on public.quota_reservations(user_id, event_type, status, period_end);

alter table public.quota_reservations enable row level security;

drop policy if exists "users can read own quota reservations" on public.quota_reservations;
create policy "users can read own quota reservations"
on public.quota_reservations for select
using (auth.uid() = user_id);

drop policy if exists "admins can read quota reservations" on public.quota_reservations;
create policy "admins can read quota reservations"
on public.quota_reservations for select
using (public.is_admin());

create or replace function public.reserve_quota_event(
  p_event_type public.quota_event_type,
  p_resource_type text,
  p_resource_id uuid,
  p_operation_key text,
  p_amount integer default 1,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_tier_id uuid;
  v_application_limit integer;
  v_generation_limit integer;
  v_period_days integer;
  v_limit integer;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_existing public.quota_reservations%rowtype;
  v_used integer := 0;
  v_reserved integer := 0;
  v_reservation public.quota_reservations%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_amount <= 0 then
    raise exception 'INVALID_QUOTA_AMOUNT';
  end if;

  if p_operation_key is null or length(trim(p_operation_key)) < 8 then
    raise exception 'INVALID_QUOTA_OPERATION_KEY';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text || ':quota:' || p_event_type::text));

  select *
  into v_existing
  from public.quota_reservations
  where user_id = v_user_id
    and event_type = p_event_type
    and operation_key = left(trim(p_operation_key), 180)
  limit 1;

  if v_existing.id is not null and v_existing.status in ('reserved', 'finalized') then
    return jsonb_build_object(
      'reservationId', v_existing.id,
      'quotaEventId', v_existing.quota_event_id,
      'status', v_existing.status
    );
  end if;

  select ut.tier_id, t.application_limit, t.generation_limit, t.period_days
  into v_tier_id, v_application_limit, v_generation_limit, v_period_days
  from public.user_tiers ut
  join public.tiers t on t.id = ut.tier_id
  where ut.user_id = v_user_id
    and ut.status = 'active'
    and t.is_active = true
    and ut.starts_at <= now()
    and (ut.ends_at is null or ut.ends_at > now())
  order by ut.created_at desc
  limit 1;

  if v_tier_id is null then
    raise exception 'QUOTA_TIER_REQUIRED';
  end if;

  v_period_start := now() - make_interval(days => greatest(coalesce(v_period_days, 30), 1));
  v_period_end := now() + make_interval(days => greatest(coalesce(v_period_days, 30), 1));

  v_limit := case
    when p_event_type = 'application_logged' then v_application_limit
    when p_event_type = 'generation_created' then v_generation_limit
    else null
  end;

  if v_limit is not null then
    select coalesce(sum(amount), 0)
    into v_used
    from public.quota_events
    where user_id = v_user_id
      and event_type = p_event_type
      and created_at >= v_period_start;

    select coalesce(sum(amount), 0)
    into v_reserved
    from public.quota_reservations
    where user_id = v_user_id
      and event_type = p_event_type
      and status = 'reserved'
      and period_end > now();

    if v_used + v_reserved + p_amount > v_limit then
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
        'quota.limit.denied',
        p_resource_type,
        p_resource_id,
        jsonb_build_object(
          'amount', p_amount,
          'event_type', p_event_type,
          'limit', v_limit,
          'operation_key', left(trim(p_operation_key), 180),
          'period_days', v_period_days,
          'reserved', v_reserved,
          'used', v_used
        ) || coalesce(p_metadata, '{}'::jsonb)
      );

      raise exception 'QUOTA_LIMIT_REACHED';
    end if;
  end if;

  if v_existing.id is not null and v_existing.status in ('released', 'expired') then
    update public.quota_reservations
    set
      amount = p_amount,
      metadata = coalesce(p_metadata, '{}'::jsonb),
      period_start = now(),
      period_end = v_period_end,
      release_reason = null,
      released_at = null,
      resource_id = p_resource_id,
      resource_type = p_resource_type,
      status = 'reserved',
      tier_id = v_tier_id,
      updated_at = now()
    where id = v_existing.id
    returning * into v_reservation;
  else
    insert into public.quota_reservations (
      user_id,
      tier_id,
      event_type,
      resource_type,
      resource_id,
      amount,
      operation_key,
      period_start,
      period_end,
      metadata
    )
    values (
      v_user_id,
      v_tier_id,
      p_event_type,
      p_resource_type,
      p_resource_id,
      p_amount,
      left(trim(p_operation_key), 180),
      now(),
      v_period_end,
      coalesce(p_metadata, '{}'::jsonb)
    )
    returning * into v_reservation;
  end if;

  return jsonb_build_object(
    'reservationId', v_reservation.id,
    'quotaEventId', v_reservation.quota_event_id,
    'status', v_reservation.status
  );
end;
$$;

create or replace function public.finalize_quota_reservation(
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
  v_reservation public.quota_reservations%rowtype;
  v_quota_event_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_user_id::text || ':quota:finalize'));

  select *
  into v_reservation
  from public.quota_reservations
  where id = p_reservation_id
    and user_id = v_user_id
  for update;

  if v_reservation.id is null then
    raise exception 'QUOTA_RESERVATION_NOT_FOUND';
  end if;

  if v_reservation.status = 'finalized' then
    return jsonb_build_object(
      'reservationId', v_reservation.id,
      'quotaEventId', v_reservation.quota_event_id,
      'status', v_reservation.status
    );
  end if;

  if v_reservation.status <> 'reserved' then
    raise exception 'QUOTA_RESERVATION_NOT_ACTIVE';
  end if;

  insert into public.quota_events (
    user_id,
    tier_id,
    event_type,
    resource_type,
    resource_id,
    amount,
    period_start,
    period_end,
    metadata
  )
  values (
    v_reservation.user_id,
    v_reservation.tier_id,
    v_reservation.event_type,
    v_reservation.resource_type,
    coalesce(p_resource_id, v_reservation.resource_id),
    v_reservation.amount,
    v_reservation.period_start,
    v_reservation.period_end,
    v_reservation.metadata || coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'operation_key', v_reservation.operation_key,
      'quota_reservation_id', v_reservation.id
    )
  )
  returning id into v_quota_event_id;

  update public.quota_reservations
  set
    finalized_at = now(),
    metadata = v_reservation.metadata || coalesce(p_metadata, '{}'::jsonb),
    quota_event_id = v_quota_event_id,
    resource_id = coalesce(p_resource_id, v_reservation.resource_id),
    status = 'finalized',
    updated_at = now()
  where id = v_reservation.id
  returning * into v_reservation;

  return jsonb_build_object(
    'reservationId', v_reservation.id,
    'quotaEventId', v_quota_event_id,
    'status', v_reservation.status
  );
end;
$$;

create or replace function public.release_quota_reservation(
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
  v_reservation public.quota_reservations%rowtype;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
  into v_reservation
  from public.quota_reservations
  where id = p_reservation_id
    and user_id = v_user_id
  for update;

  if v_reservation.id is null then
    raise exception 'QUOTA_RESERVATION_NOT_FOUND';
  end if;

  if v_reservation.status = 'finalized' then
    return jsonb_build_object(
      'reservationId', v_reservation.id,
      'quotaEventId', v_reservation.quota_event_id,
      'status', v_reservation.status
    );
  end if;

  update public.quota_reservations
  set
    metadata = metadata || coalesce(p_metadata, '{}'::jsonb),
    release_reason = p_reason,
    released_at = now(),
    status = 'released',
    updated_at = now()
  where id = v_reservation.id
  returning * into v_reservation;

  return jsonb_build_object(
    'reservationId', v_reservation.id,
    'quotaEventId', v_reservation.quota_event_id,
    'status', v_reservation.status
  );
end;
$$;

create or replace function public.record_quota_event(
  p_event_type public.quota_event_type,
  p_resource_type text,
  p_resource_id uuid,
  p_amount integer default 1,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation_key text;
  v_reservation jsonb;
  v_finalized jsonb;
begin
  v_operation_key := coalesce(
    p_metadata ->> 'operation_key',
    p_event_type::text || ':' || p_resource_type || ':' || coalesce(p_resource_id::text, gen_random_uuid()::text)
  );

  v_reservation := public.reserve_quota_event(
    p_event_type,
    p_resource_type,
    p_resource_id,
    v_operation_key,
    p_amount,
    p_metadata
  );

  v_finalized := public.finalize_quota_reservation(
    (v_reservation ->> 'reservationId')::uuid,
    p_resource_id,
    p_metadata
  );

  return (v_finalized ->> 'quotaEventId')::uuid;
end;
$$;

create or replace function public.create_application_from_job(
  p_job_ingestion_id uuid,
  p_decision text,
  p_decision_reason text default null,
  p_override_skip boolean default false,
  p_status public.application_status default 'draft',
  p_operation_key text default null
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
  v_quota jsonb;
  v_quota_event_id uuid;
  v_operation_key text;
  v_quota_metadata jsonb;
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
    v_operation_key := coalesce(
      nullif(trim(p_operation_key), ''),
      'applicationCreate:' || v_job.id::text
    );
    v_quota_metadata := jsonb_build_object(
      'decision_reason', p_decision_reason,
      'fit_decision', p_decision,
      'job_ingestion_id', v_job.id,
      'operation_key', v_operation_key
    );
    v_quota := public.reserve_quota_event(
      'application_logged',
      'application',
      null,
      v_operation_key,
      1,
      v_quota_metadata
    );

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

    v_quota := public.finalize_quota_reservation(
      (v_quota ->> 'reservationId')::uuid,
      v_application.id,
      jsonb_build_object('application_id', v_application.id)
    );
    v_quota_event_id := (v_quota ->> 'quotaEventId')::uuid;

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

revoke all on function public.reserve_quota_event(public.quota_event_type, text, uuid, text, integer, jsonb) from public;
revoke all on function public.finalize_quota_reservation(uuid, uuid, jsonb) from public;
revoke all on function public.release_quota_reservation(uuid, text, jsonb) from public;
revoke all on function public.record_quota_event(public.quota_event_type, text, uuid, integer, jsonb) from public;
revoke all on function public.create_application_from_job(uuid, text, text, boolean, public.application_status, text) from public;

grant execute on function public.reserve_quota_event(public.quota_event_type, text, uuid, text, integer, jsonb) to authenticated;
grant execute on function public.finalize_quota_reservation(uuid, uuid, jsonb) to authenticated;
grant execute on function public.release_quota_reservation(uuid, text, jsonb) to authenticated;
grant execute on function public.record_quota_event(public.quota_event_type, text, uuid, integer, jsonb) to authenticated;
grant execute on function public.create_application_from_job(uuid, text, text, boolean, public.application_status, text) to authenticated;

revoke all on function public.create_application_from_job(uuid, text, text, boolean, public.application_status) from public;
