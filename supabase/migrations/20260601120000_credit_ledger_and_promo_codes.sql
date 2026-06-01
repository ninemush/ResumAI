create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  credit_delta integer not null check (credit_delta <> 0),
  resource_type text,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null default '',
  credit_amount integer not null check (credit_amount > 0),
  max_redemptions integer not null default 1 check (max_redemptions > 0),
  assigned_user_id uuid references auth.users(id) on delete cascade,
  assigned_user_email text,
  valid_from timestamptz not null default now(),
  expires_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promo_codes_code_format check (code = upper(code) and code ~ '^[A-Z0-9][A-Z0-9_-]{3,39}$')
);

create table if not exists public.promo_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references public.promo_codes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  credit_ledger_id uuid not null references public.credit_ledger(id) on delete restrict,
  redeemed_at timestamptz not null default now(),
  unique (promo_code_id, user_id)
);

create table if not exists public.revenuecat_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  app_user_id text,
  product_id text,
  credit_amount integer not null default 0,
  processed_status text not null default 'processed',
  raw_event jsonb not null default '{}'::jsonb,
  credit_ledger_id uuid references public.credit_ledger(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists credit_ledger_user_id_created_at_idx
on public.credit_ledger(user_id, created_at desc);

create index if not exists credit_ledger_resource_idx
on public.credit_ledger(resource_type, resource_id);

create index if not exists promo_codes_assigned_user_id_idx
on public.promo_codes(assigned_user_id);

create index if not exists promo_codes_assigned_user_email_idx
on public.promo_codes(lower(assigned_user_email));

create index if not exists promo_code_redemptions_user_id_idx
on public.promo_code_redemptions(user_id, redeemed_at desc);

create trigger promo_codes_set_updated_at
before update on public.promo_codes
for each row execute function public.set_updated_at();

alter table public.credit_ledger enable row level security;
alter table public.promo_codes enable row level security;
alter table public.promo_code_redemptions enable row level security;
alter table public.revenuecat_events enable row level security;

drop policy if exists "users can read own credit ledger" on public.credit_ledger;
create policy "users can read own credit ledger"
on public.credit_ledger for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "admins can read all credit ledger" on public.credit_ledger;
create policy "admins can read all credit ledger"
on public.credit_ledger for select
to authenticated
using (public.is_admin());

drop policy if exists "admins can manage credit ledger" on public.credit_ledger;
create policy "admins can manage credit ledger"
on public.credit_ledger for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "admins can manage promo codes" on public.promo_codes;
create policy "admins can manage promo codes"
on public.promo_codes for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "users can read own promo redemptions" on public.promo_code_redemptions;
create policy "users can read own promo redemptions"
on public.promo_code_redemptions for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "admins can read promo redemptions" on public.promo_code_redemptions;
create policy "admins can read promo redemptions"
on public.promo_code_redemptions for select
to authenticated
using (public.is_admin());

drop policy if exists "admins can read revenuecat events" on public.revenuecat_events;
create policy "admins can read revenuecat events"
on public.revenuecat_events for select
to authenticated
using (public.is_admin());

create or replace function public.grant_signup_credits_if_missing(
  p_user_id uuid default auth.uid()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_free_credits integer := coalesce(nullif(current_setting('app.signup_free_credits', true), '')::integer, 10);
begin
  if p_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_user_id <> auth.uid() and not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 42));

  insert into public.credit_ledger (
    user_id,
    event_type,
    credit_delta,
    resource_type,
    metadata
  )
  select
    p_user_id,
    'signup_bonus',
    v_free_credits,
    'account',
    jsonb_build_object('free_credit_limit', v_free_credits)
  where not exists (
    select 1
    from public.credit_ledger
    where user_id = p_user_id
      and event_type = 'signup_bonus'
  );
end;
$$;

create or replace function public.get_credit_summary(
  p_user_id uuid default auth.uid()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer := 0;
  v_signup_credits integer := 0;
  v_promo_credits integer := 0;
  v_purchased_credits integer := 0;
  v_used_credits integer := 0;
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
    coalesce(sum(credit_delta) filter (where event_type = 'signup_bonus'), 0),
    coalesce(sum(credit_delta) filter (where event_type = 'promo_code_redeemed'), 0),
    coalesce(sum(credit_delta) filter (where event_type = 'revenuecat_purchase'), 0),
    abs(coalesce(sum(credit_delta) filter (where credit_delta < 0), 0))
  into
    v_balance,
    v_signup_credits,
    v_promo_credits,
    v_purchased_credits,
    v_used_credits
  from public.credit_ledger
  where user_id = p_user_id;

  if (v_signup_credits + v_promo_credits + v_purchased_credits) > 0 then
    v_usage_percent := least(
      100,
      round((v_used_credits::numeric / (v_signup_credits + v_promo_credits + v_purchased_credits)::numeric) * 100, 2)
    );
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
    'totalCredits', v_signup_credits + v_promo_credits + v_purchased_credits,
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
  into v_balance
  from public.credit_ledger
  where user_id = v_user_id;

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

create or replace function public.redeem_promo_code(
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_code text := upper(trim(p_code));
  v_promo public.promo_codes%rowtype;
  v_redemptions integer := 0;
  v_ledger_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if v_code = '' then
    raise exception 'PROMO_CODE_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 43));
  perform public.grant_signup_credits_if_missing(v_user_id);

  select *
  into v_promo
  from public.promo_codes
  where code = v_code
    and is_active = true
    and valid_from <= now()
    and (expires_at is null or expires_at > now());

  if not found then
    raise exception 'PROMO_CODE_INVALID';
  end if;

  if v_promo.assigned_user_id is not null and v_promo.assigned_user_id <> v_user_id then
    raise exception 'PROMO_CODE_NOT_ASSIGNED';
  end if;

  if v_promo.assigned_user_email is not null and lower(v_promo.assigned_user_email) <> v_user_email then
    raise exception 'PROMO_CODE_NOT_ASSIGNED';
  end if;

  select count(*)
  into v_redemptions
  from public.promo_code_redemptions
  where promo_code_id = v_promo.id;

  if v_redemptions >= v_promo.max_redemptions then
    raise exception 'PROMO_CODE_EXHAUSTED';
  end if;

  if exists (
    select 1
    from public.promo_code_redemptions
    where promo_code_id = v_promo.id
      and user_id = v_user_id
  ) then
    raise exception 'PROMO_CODE_ALREADY_REDEEMED';
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
    'promo_code_redeemed',
    v_promo.credit_amount,
    'promo_code',
    v_promo.id,
    jsonb_build_object('code', v_promo.code, 'description', v_promo.description)
  )
  returning id into v_ledger_id;

  insert into public.promo_code_redemptions (
    promo_code_id,
    user_id,
    credit_ledger_id
  )
  values (
    v_promo.id,
    v_user_id,
    v_ledger_id
  );

  return public.get_credit_summary(v_user_id);
end;
$$;

revoke all on function public.grant_signup_credits_if_missing(uuid) from public;
revoke all on function public.get_credit_summary(uuid) from public;
revoke all on function public.consume_credits(integer, text, text, uuid, jsonb) from public;
revoke all on function public.redeem_promo_code(text) from public;

grant execute on function public.grant_signup_credits_if_missing(uuid) to authenticated;
grant execute on function public.get_credit_summary(uuid) to authenticated;
grant execute on function public.consume_credits(integer, text, text, uuid, jsonb) to authenticated;
grant execute on function public.redeem_promo_code(text) to authenticated;
