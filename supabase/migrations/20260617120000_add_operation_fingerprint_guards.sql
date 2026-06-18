alter table public.credit_reservations
add column if not exists operation_fingerprint text;

alter table public.credit_operation_outputs
add column if not exists operation_fingerprint text;

alter table public.quota_reservations
add column if not exists operation_fingerprint text;

create index if not exists credit_reservations_fingerprint_idx
on public.credit_reservations(user_id, idempotency_key, operation_fingerprint)
where operation_fingerprint is not null;

create index if not exists credit_operation_outputs_fingerprint_idx
on public.credit_operation_outputs(user_id, feature, operation_key, operation_fingerprint)
where operation_fingerprint is not null;

create index if not exists quota_reservations_fingerprint_idx
on public.quota_reservations(user_id, event_type, operation_key, operation_fingerprint)
where operation_fingerprint is not null;

drop function if exists public.reserve_credits(integer, text, text, uuid, text, jsonb, integer);
drop function if exists public.reserve_credits(integer, text, text, uuid, text, jsonb, integer, text);

create or replace function public.reserve_credits(
  p_amount integer,
  p_feature text,
  p_resource_type text,
  p_resource_id uuid default null,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_expires_in_seconds integer default 1800,
  p_operation_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_key text := nullif(left(trim(coalesce(p_idempotency_key, '')), 180), '');
  v_fingerprint text := nullif(left(trim(coalesce(p_operation_fingerprint, '')), 128), '');
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
    if v_existing.feature = p_feature
      and v_existing.amount = p_amount
      and v_existing.resource_type = p_resource_type
      and v_existing.resource_id is not distinct from p_resource_id
      and (
        v_existing.operation_fingerprint is null
        or v_fingerprint is null
        or v_existing.operation_fingerprint = v_fingerprint
      )
    then
      return jsonb_build_object(
        'reservationId', v_existing.id,
        'status', v_existing.status,
        'ledgerEventId', v_existing.ledger_event_id,
        'summary', public.get_credit_summary(v_user_id)
      );
    end if;

    raise exception 'CREDIT_IDEMPOTENCY_MISMATCH';
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
    operation_fingerprint,
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
    v_fingerprint,
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

drop function if exists public.finalize_credit_reservation_with_output(uuid, uuid, jsonb, jsonb, jsonb, text);
drop function if exists public.finalize_credit_reservation_with_output(uuid, uuid, jsonb, jsonb, jsonb, text, text);

create or replace function public.finalize_credit_reservation_with_output(
  p_reservation_id uuid,
  p_resource_id uuid default null,
  p_ledger_metadata jsonb default '{}'::jsonb,
  p_output_ids jsonb default '{}'::jsonb,
  p_record_metadata jsonb default '{}'::jsonb,
  p_resource_type text default null,
  p_operation_fingerprint text default null
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
  v_resource_id uuid;
  v_resource_type text;
  v_fingerprint text := nullif(left(trim(coalesce(p_operation_fingerprint, '')), 128), '');
  v_existing_output_fingerprint text;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_output_ids is null or jsonb_typeof(p_output_ids) <> 'object' then
    raise exception 'CREDIT_OPERATION_OUTPUT_REQUIRED';
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

  if v_reservation.status not in ('reserved', 'finalized') then
    raise exception 'CREDIT_RESERVATION_NOT_FINALIZABLE';
  end if;

  if v_reservation.operation_fingerprint is not null
    and v_fingerprint is not null
    and v_reservation.operation_fingerprint <> v_fingerprint
  then
    raise exception 'CREDIT_IDEMPOTENCY_MISMATCH';
  end if;

  select operation_fingerprint
  into v_existing_output_fingerprint
  from public.credit_operation_outputs
  where user_id = v_user_id
    and feature = v_reservation.feature
    and operation_key = v_reservation.idempotency_key
  limit 1;

  if v_existing_output_fingerprint is not null
    and v_fingerprint is not null
    and v_existing_output_fingerprint <> v_fingerprint
  then
    raise exception 'CREDIT_IDEMPOTENCY_MISMATCH';
  end if;

  v_resource_id := coalesce(p_resource_id, v_reservation.resource_id);
  v_resource_type := coalesce(nullif(trim(coalesce(p_resource_type, '')), ''), v_reservation.resource_type);
  v_fingerprint := coalesce(v_reservation.operation_fingerprint, v_fingerprint);

  if v_reservation.status = 'reserved' then
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
      v_resource_type,
      v_resource_id,
      v_reservation.idempotency_key,
      v_reservation.metadata ||
        coalesce(p_ledger_metadata, '{}'::jsonb) ||
        jsonb_build_object(
          'operation_fingerprint', v_fingerprint,
          'reservation_id', v_reservation.id,
          'operation_key', v_reservation.idempotency_key,
          'output_ids', p_output_ids
        )
    )
    returning id into v_ledger_id;

    update public.credit_reservations
    set
      status = 'finalized',
      ledger_event_id = v_ledger_id,
      operation_fingerprint = v_fingerprint,
      resource_id = v_resource_id,
      metadata = metadata || coalesce(p_ledger_metadata, '{}'::jsonb)
    where id = v_reservation.id
    returning * into v_reservation;
  else
    v_ledger_id := v_reservation.ledger_event_id;
  end if;

  insert into public.credit_operation_outputs (
    user_id,
    feature,
    operation_key,
    operation_fingerprint,
    reservation_id,
    ledger_event_id,
    resource_type,
    resource_id,
    output_ids,
    status,
    metadata
  )
  values (
    v_user_id,
    v_reservation.feature,
    v_reservation.idempotency_key,
    v_fingerprint,
    v_reservation.id,
    v_ledger_id,
    v_resource_type,
    v_resource_id,
    p_output_ids,
    'succeeded',
    coalesce(p_record_metadata, '{}'::jsonb)
  )
  on conflict (user_id, feature, operation_key)
  do update set
    ledger_event_id = excluded.ledger_event_id,
    metadata = public.credit_operation_outputs.metadata || excluded.metadata,
    operation_fingerprint = coalesce(public.credit_operation_outputs.operation_fingerprint, excluded.operation_fingerprint),
    output_ids = excluded.output_ids,
    reservation_id = excluded.reservation_id,
    resource_id = excluded.resource_id,
    resource_type = excluded.resource_type,
    status = 'succeeded';

  return jsonb_build_object(
    'reservationId', v_reservation.id,
    'status', v_reservation.status,
    'ledgerEventId', v_reservation.ledger_event_id,
    'summary', public.get_credit_summary(v_user_id)
  );
end;
$$;

drop function if exists public.reserve_quota_event(public.quota_event_type, text, uuid, text, integer, jsonb);
drop function if exists public.reserve_quota_event(public.quota_event_type, text, uuid, text, integer, jsonb, text);

create or replace function public.reserve_quota_event(
  p_event_type public.quota_event_type,
  p_resource_type text,
  p_resource_id uuid,
  p_operation_key text,
  p_amount integer default 1,
  p_metadata jsonb default '{}'::jsonb,
  p_operation_fingerprint text default null
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
  v_operation_key text := left(trim(p_operation_key), 180);
  v_fingerprint text := nullif(left(trim(coalesce(p_operation_fingerprint, '')), 128), '');
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
    and operation_key = v_operation_key
  limit 1;

  if v_existing.id is not null then
    if not (
      v_existing.amount = p_amount
      and v_existing.resource_type = p_resource_type
      and v_existing.resource_id is not distinct from p_resource_id
      and (
        v_existing.operation_fingerprint is null
        or v_fingerprint is null
        or v_existing.operation_fingerprint = v_fingerprint
      )
    ) then
      raise exception 'QUOTA_IDEMPOTENCY_MISMATCH';
    end if;

    if v_existing.status in ('reserved', 'finalized') then
      return jsonb_build_object(
        'reservationId', v_existing.id,
        'quotaEventId', v_existing.quota_event_id,
        'status', v_existing.status
      );
    end if;
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
          'operation_fingerprint', v_fingerprint,
          'operation_key', v_operation_key,
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
      operation_fingerprint = v_fingerprint,
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
      operation_fingerprint,
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
      v_operation_key,
      v_fingerprint,
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

drop function if exists public.record_quota_event(public.quota_event_type, text, uuid, integer, jsonb);
drop function if exists public.record_quota_event(public.quota_event_type, text, uuid, integer, jsonb, text);

create or replace function public.record_quota_event(
  p_event_type public.quota_event_type,
  p_resource_type text,
  p_resource_id uuid,
  p_amount integer default 1,
  p_metadata jsonb default '{}'::jsonb,
  p_operation_fingerprint text default null
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
    p_metadata,
    p_operation_fingerprint
  );

  v_finalized := public.finalize_quota_reservation(
    (v_reservation ->> 'reservationId')::uuid,
    p_resource_id,
    p_metadata
  );

  return (v_finalized ->> 'quotaEventId')::uuid;
end;
$$;

drop function if exists public.create_application_from_job(uuid, text, text, boolean, public.application_status, text);
drop function if exists public.create_application_from_job(uuid, text, text, boolean, public.application_status, text, text);

create or replace function public.create_application_from_job(
  p_job_ingestion_id uuid,
  p_decision text,
  p_decision_reason text default null,
  p_override_skip boolean default false,
  p_status public.application_status default 'draft',
  p_operation_key text default null,
  p_operation_fingerprint text default null
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
      'operation_fingerprint', nullif(left(trim(coalesce(p_operation_fingerprint, '')), 128), ''),
      'operation_key', v_operation_key
    );
    v_quota := public.reserve_quota_event(
      'application_logged',
      'application',
      null,
      v_operation_key,
      1,
      v_quota_metadata,
      p_operation_fingerprint
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

revoke all on function public.reserve_credits(integer, text, text, uuid, text, jsonb, integer, text) from public;
revoke all on function public.finalize_credit_reservation_with_output(uuid, uuid, jsonb, jsonb, jsonb, text, text) from public;
revoke all on function public.reserve_quota_event(public.quota_event_type, text, uuid, text, integer, jsonb, text) from public;
revoke all on function public.record_quota_event(public.quota_event_type, text, uuid, integer, jsonb, text) from public;
revoke all on function public.create_application_from_job(uuid, text, text, boolean, public.application_status, text, text) from public;

grant execute on function public.reserve_credits(integer, text, text, uuid, text, jsonb, integer, text) to authenticated;
grant execute on function public.finalize_credit_reservation_with_output(uuid, uuid, jsonb, jsonb, jsonb, text, text) to authenticated;
grant execute on function public.reserve_quota_event(public.quota_event_type, text, uuid, text, integer, jsonb, text) to authenticated;
grant execute on function public.record_quota_event(public.quota_event_type, text, uuid, integer, jsonb, text) to authenticated;
grant execute on function public.create_application_from_job(uuid, text, text, boolean, public.application_status, text, text) to authenticated;

/*
  Rollback / forward-fix:
  - The columns are nullable and can remain safely if callers must be rolled
    back temporarily.
  - To relax enforcement, replace the affected RPCs with the prior definitions
    from 20260614120000 and 20260612103000 while keeping this evidence data.
*/
