create extension if not exists pgcrypto;

create table if not exists public.rate_limit_buckets (
  bucket_key_hash text primary key,
  bucket_scope text not null default 'unknown',
  request_count integer not null default 0,
  limit_count integer not null,
  window_ms integer not null,
  reset_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rate_limit_buckets_request_count_check check (request_count >= 0),
  constraint rate_limit_buckets_limit_count_check check (limit_count between 1 and 100000),
  constraint rate_limit_buckets_window_ms_check check (window_ms between 1000 and 86400000)
);

create index if not exists rate_limit_buckets_reset_at_idx
  on public.rate_limit_buckets (reset_at);

alter table public.rate_limit_buckets enable row level security;

revoke all on table public.rate_limit_buckets from anon, authenticated;

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

  delete from public.rate_limit_buckets
    where reset_at < p_now - interval '1 day';

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

revoke all on function public.check_rate_limit(text, integer, integer, timestamptz) from public;
grant execute on function public.check_rate_limit(text, integer, integer, timestamptz) to anon, authenticated;

comment on table public.rate_limit_buckets is
  'Durable hashed rate-limit buckets for production API abuse controls. Raw client keys are not stored.';

comment on function public.check_rate_limit(text, integer, integer, timestamptz) is
  'Atomically checks and increments a hashed rate-limit bucket for Next.js route handlers.';
