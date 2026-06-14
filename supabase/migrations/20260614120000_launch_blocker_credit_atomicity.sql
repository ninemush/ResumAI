drop policy if exists "users can insert own credit operation outputs" on public.credit_operation_outputs;
drop policy if exists "users can update own pending credit operation outputs" on public.credit_operation_outputs;

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
    if v_existing.feature = p_feature
      and v_existing.amount = p_amount
      and v_existing.resource_type = p_resource_type
      and v_existing.resource_id is not distinct from p_resource_id
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

create or replace function public.finalize_credit_reservation_with_output(
  p_reservation_id uuid,
  p_resource_id uuid default null,
  p_ledger_metadata jsonb default '{}'::jsonb,
  p_output_ids jsonb default '{}'::jsonb,
  p_record_metadata jsonb default '{}'::jsonb,
  p_resource_type text default null
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

  v_resource_id := coalesce(p_resource_id, v_reservation.resource_id);
  v_resource_type := coalesce(nullif(trim(coalesce(p_resource_type, '')), ''), v_reservation.resource_type);

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

revoke all on function public.finalize_credit_reservation_with_output(
  uuid,
  uuid,
  jsonb,
  jsonb,
  jsonb,
  text
) from public;

grant execute on function public.finalize_credit_reservation_with_output(
  uuid,
  uuid,
  jsonb,
  jsonb,
  jsonb,
  text
) to authenticated;

/*
  Rollback:
  - Restore user insert/update policies only if operation outputs must be
    temporarily client-owned during incident response.
  - Revert reserve_credits to the previous implementation only as a forward-fix
    if the stricter key reuse check blocks valid retries.
  - The atomic finalize/output RPC is additive; callers can temporarily fall
    back to finalize_credit_reservation if output recording is disabled.
*/
