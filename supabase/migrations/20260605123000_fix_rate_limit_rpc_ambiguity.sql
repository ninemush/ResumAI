create or replace function public.check_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_ms integer,
  p_now timestamptz default now()
)
returns table (
  allowed boolean,
  remaining integer,
  reset_at timestamptz,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_bucket_key text := trim(coalesce(p_bucket_key, ''));
  v_bucket_hash text;
  v_bucket_scope text;
  v_window interval;
  v_count integer;
  v_reset_at timestamptz;
begin
  if v_bucket_key = '' or length(v_bucket_key) > 512 then
    raise exception 'Invalid rate-limit bucket key.';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100000 then
    raise exception 'Invalid rate-limit limit.';
  end if;

  if p_window_ms is null or p_window_ms < 1000 or p_window_ms > 86400000 then
    raise exception 'Invalid rate-limit window.';
  end if;

  v_bucket_hash := encode(digest(v_bucket_key, 'sha256'), 'hex');
  v_bucket_scope := left(coalesce(nullif(split_part(v_bucket_key, ':', 1), ''), 'unknown'), 64);
  v_window := (p_window_ms::text || ' milliseconds')::interval;

  delete from public.rate_limit_buckets as expired_buckets
    where expired_buckets.reset_at < p_now - interval '1 day';

  insert into public.rate_limit_buckets as buckets (
    bucket_key_hash,
    bucket_scope,
    request_count,
    limit_count,
    window_ms,
    reset_at,
    updated_at
  )
  values (
    v_bucket_hash,
    v_bucket_scope,
    1,
    p_limit,
    p_window_ms,
    p_now + v_window,
    p_now
  )
  on conflict (bucket_key_hash)
  do update set
    bucket_scope = excluded.bucket_scope,
    request_count = case
      when buckets.reset_at <= p_now then 1
      else least(buckets.request_count + 1, p_limit + 1)
    end,
    limit_count = p_limit,
    window_ms = p_window_ms,
    reset_at = case
      when buckets.reset_at <= p_now then p_now + v_window
      else buckets.reset_at
    end,
    updated_at = p_now
  returning buckets.request_count, buckets.reset_at
    into v_count, v_reset_at;

  return query
    select
      v_count <= p_limit as allowed,
      greatest(p_limit - v_count, 0) as remaining,
      v_reset_at as reset_at,
      case
        when v_count <= p_limit then 0
        else greatest(ceil(extract(epoch from (v_reset_at - p_now)))::integer, 1)
      end as retry_after_seconds;
end;
$$;
