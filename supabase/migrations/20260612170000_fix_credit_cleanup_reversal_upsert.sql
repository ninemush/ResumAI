drop index if exists public.credit_reversals_provider_reference_idx;

create unique index if not exists credit_reversals_provider_reference_idx
on public.credit_reversals(provider_reference);

drop function if exists public.cleanup_stale_credit_reservations();

create or replace function public.cleanup_stale_credit_reservations()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_feature_totals jsonb := '{}'::jsonb;
  v_expired_count integer := 0;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  with stale as (
    select id, feature
    from public.credit_reservations
    where status = 'reserved'
      and expires_at <= now()
  ),
  feature_totals as (
    select coalesce(jsonb_object_agg(feature, feature_count), '{}'::jsonb) as totals
    from (
      select feature, count(*)::integer as feature_count
      from stale
      group by feature
    ) grouped
  ),
  expired as (
    update public.credit_reservations reservations
    set
      status = 'expired',
      metadata = metadata || jsonb_build_object('expired_by_cleanup_at', now())
    where reservations.id in (select id from stale)
    returning reservations.id
  )
  select
    coalesce((select totals from feature_totals), '{}'::jsonb),
    coalesce((select count(*)::integer from expired), 0)
  into v_feature_totals, v_expired_count;

  return jsonb_build_object(
    'affectedFeatureTotals', v_feature_totals,
    'expiredCount', v_expired_count,
    'releasedCount', 0
  );
end;
$$;

create or replace function public.cleanup_stale_credit_reservations_count()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  v_result := public.cleanup_stale_credit_reservations();

  return coalesce((v_result ->> 'expiredCount')::integer, 0);
end;
$$;

revoke all on function public.cleanup_stale_credit_reservations() from public;
revoke all on function public.cleanup_stale_credit_reservations_count() from public;

grant execute on function public.cleanup_stale_credit_reservations() to authenticated;
grant execute on function public.cleanup_stale_credit_reservations_count() to authenticated;
