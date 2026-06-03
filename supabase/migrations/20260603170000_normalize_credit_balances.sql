create or replace function public.get_credit_summary(
  p_user_id uuid default auth.uid()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw_balance integer := 0;
  v_balance integer := 0;
  v_signup_credits integer := 0;
  v_promo_credits integer := 0;
  v_purchased_credits integer := 0;
  v_used_credits integer := 0;
  v_total_credits integer := 0;
  v_usage_percent numeric := 0;
  v_threshold integer := null;
begin
  if p_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_user_id <> auth.uid() and not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  perform public.grant_signup_credits_if_missing(p_user_id);

  select
    coalesce(sum(credit_delta), 0),
    greatest(0, coalesce(sum(credit_delta) filter (where event_type = 'signup_bonus'), 0)),
    greatest(
      0,
      coalesce(
        sum(credit_delta)
          filter (where credit_delta > 0 and event_type not in ('signup_bonus', 'revenuecat_purchase')),
        0
      )
    ),
    greatest(0, coalesce(sum(credit_delta) filter (where event_type = 'revenuecat_purchase'), 0)),
    abs(coalesce(sum(credit_delta) filter (where credit_delta < 0), 0))
  into
    v_raw_balance,
    v_signup_credits,
    v_promo_credits,
    v_purchased_credits,
    v_used_credits
  from public.credit_ledger
  where user_id = p_user_id;

  v_balance := greatest(0, v_raw_balance);
  v_total_credits := greatest(0, v_signup_credits + v_promo_credits + v_purchased_credits);

  if v_total_credits > 0 then
    v_usage_percent := least(100, round((v_used_credits::numeric / v_total_credits::numeric) * 100, 2));
  end if;

  v_threshold := case
    when v_usage_percent >= 90 then 90
    when v_usage_percent >= 75 then 75
    when v_usage_percent >= 50 then 50
    else null
  end;

  return jsonb_build_object(
    'balance', v_balance,
    'signupCredits', v_signup_credits,
    'promoCredits', v_promo_credits,
    'purchasedCredits', v_purchased_credits,
    'usedCredits', v_used_credits,
    'totalCredits', v_total_credits,
    'usagePercent', v_usage_percent,
    'warningThreshold', v_threshold,
    'isExhausted', v_balance <= 0
  );
end;
$$;

create or replace function public.consume_credits(
  p_amount integer,
  p_event_type text,
  p_resource_type text default null,
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
  v_raw_balance integer := 0;
  v_balance integer := 0;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_CREDIT_AMOUNT';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 42));
  perform public.grant_signup_credits_if_missing(v_user_id);

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
    metadata
  )
  values (
    v_user_id,
    p_event_type,
    -p_amount,
    p_resource_type,
    p_resource_id,
    coalesce(p_metadata, '{}'::jsonb)
  );

  return public.get_credit_summary(v_user_id);
end;
$$;

create or replace function public.prevent_negative_credit_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer := 0;
begin
  if new.credit_delta >= 0 then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(sum(credit_delta), 0)
    into v_balance
    from public.credit_ledger
    where user_id = new.user_id
      and id <> old.id;
  else
    select coalesce(sum(credit_delta), 0)
    into v_balance
    from public.credit_ledger
    where user_id = new.user_id;
  end if;

  if greatest(0, v_balance) + new.credit_delta < 0 then
    raise exception 'CREDITS_EXHAUSTED';
  end if;

  return new;
end;
$$;

drop trigger if exists credit_ledger_prevent_negative_balance on public.credit_ledger;

create trigger credit_ledger_prevent_negative_balance
before insert or update of user_id, credit_delta on public.credit_ledger
for each row execute function public.prevent_negative_credit_balance();

revoke all on function public.prevent_negative_credit_balance() from public;
revoke all on function public.get_credit_summary(uuid) from public;
revoke all on function public.consume_credits(integer, text, text, uuid, jsonb) from public;

grant execute on function public.get_credit_summary(uuid) to authenticated;
grant execute on function public.consume_credits(integer, text, text, uuid, jsonb) to authenticated;
