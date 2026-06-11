alter table public.credit_ledger
add column if not exists operation_key text;

create unique index if not exists credit_ledger_user_operation_key_usage_idx
on public.credit_ledger(user_id, operation_key)
where operation_key is not null and credit_delta < 0;

create or replace function public.consume_credits(
  p_amount integer,
  p_event_type text,
  p_resource_type text default null,
  p_resource_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_operation_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_raw_balance integer := 0;
  v_balance integer := 0;
  v_operation_key text := nullif(left(trim(coalesce(p_operation_key, '')), 180), '');
  v_existing_usage_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_CREDIT_AMOUNT';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 42));
  perform public.grant_signup_credits_if_missing(v_user_id);

  if v_operation_key is not null then
    select id
    into v_existing_usage_id
    from public.credit_ledger
    where user_id = v_user_id
      and operation_key = v_operation_key
      and credit_delta < 0
    limit 1;

    if v_existing_usage_id is not null then
      return public.get_credit_summary(v_user_id);
    end if;
  end if;

  select coalesce(sum(credit_delta), 0)
  into v_raw_balance
  from public.credit_ledger
  where user_id = v_user_id;

  v_balance := greatest(0, v_raw_balance);

  if v_balance < p_amount then
    raise exception 'CREDITS_EXHAUSTED';
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
    p_event_type,
    -p_amount,
    p_resource_type,
    p_resource_id,
    v_operation_key,
    coalesce(p_metadata, '{}'::jsonb) ||
      case
        when v_operation_key is null then '{}'::jsonb
        else jsonb_build_object('operation_key', v_operation_key)
      end
  );

  return public.get_credit_summary(v_user_id);
end;
$$;

revoke all on function public.consume_credits(integer, text, text, uuid, jsonb, text) from public;
grant execute on function public.consume_credits(integer, text, text, uuid, jsonb, text) to authenticated;
