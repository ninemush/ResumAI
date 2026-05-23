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
  v_user_id uuid := auth.uid();
  v_tier_id uuid;
  v_period_days integer := 30;
  v_event_id uuid;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_amount <= 0 then
    raise exception 'INVALID_QUOTA_AMOUNT';
  end if;

  select ut.tier_id, t.period_days
  into v_tier_id, v_period_days
  from public.user_tiers ut
  join public.tiers t on t.id = ut.tier_id
  where ut.user_id = v_user_id
    and ut.status = 'active'
    and t.is_active = true
    and ut.starts_at <= now()
    and (ut.ends_at is null or ut.ends_at > now())
  order by ut.created_at desc
  limit 1;

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
    v_user_id,
    v_tier_id,
    p_event_type,
    p_resource_type,
    p_resource_id,
    p_amount,
    now(),
    now() + make_interval(days => coalesce(v_period_days, 30)),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function public.record_quota_event(
  public.quota_event_type,
  text,
  uuid,
  integer,
  jsonb
) from public;

grant execute on function public.record_quota_event(
  public.quota_event_type,
  text,
  uuid,
  integer,
  jsonb
) to authenticated;
