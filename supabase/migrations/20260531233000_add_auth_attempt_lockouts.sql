create extension if not exists pgcrypto;

create table if not exists public.auth_login_lockouts (
  email_hash text primary key,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.auth_login_lockouts enable row level security;

create or replace function public.auth_email_hash(email_input text)
returns text
language sql
stable
set search_path = public
as $$
  select encode(extensions.digest(lower(trim(coalesce(email_input, ''))), 'sha256'), 'hex')
$$;

create or replace function public.check_password_login_allowed(email_input text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := public.auth_email_hash(email_input);
  v_record public.auth_login_lockouts%rowtype;
begin
  select *
    into v_record
    from public.auth_login_lockouts
    where email_hash = v_hash;

  if not found then
    return jsonb_build_object(
      'allowed', true,
      'failedAttempts', 0,
      'lockedUntil', null
    );
  end if;

  if v_record.locked_until is not null and v_record.locked_until > now() then
    return jsonb_build_object(
      'allowed', false,
      'failedAttempts', v_record.failed_attempts,
      'lockedUntil', v_record.locked_until
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'failedAttempts', v_record.failed_attempts,
    'lockedUntil', null
  );
end;
$$;

create or replace function public.record_password_login_attempt(
  email_input text,
  was_successful boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := public.auth_email_hash(email_input);
  v_attempts integer;
  v_locked_until timestamptz;
begin
  if was_successful then
    delete from public.auth_login_lockouts where email_hash = v_hash;

    return jsonb_build_object(
      'allowed', true,
      'failedAttempts', 0,
      'lockedUntil', null
    );
  end if;

  insert into public.auth_login_lockouts (
    email_hash,
    failed_attempts,
    locked_until,
    last_failed_at,
    updated_at
  )
  values (
    v_hash,
    1,
    null,
    now(),
    now()
  )
  on conflict (email_hash)
  do update set
    failed_attempts = case
      when public.auth_login_lockouts.locked_until is not null
        and public.auth_login_lockouts.locked_until > now()
        then public.auth_login_lockouts.failed_attempts
      else public.auth_login_lockouts.failed_attempts + 1
    end,
    last_failed_at = now(),
    updated_at = now()
  returning failed_attempts into v_attempts;

  v_locked_until := case
    when v_attempts >= 3 then now() + interval '15 minutes'
    else null
  end;

  update public.auth_login_lockouts
    set locked_until = v_locked_until,
        updated_at = now()
    where email_hash = v_hash;

  return jsonb_build_object(
    'allowed', v_locked_until is null,
    'failedAttempts', v_attempts,
    'lockedUntil', v_locked_until
  );
end;
$$;

grant execute on function public.check_password_login_allowed(text) to anon, authenticated;
grant execute on function public.record_password_login_attempt(text, boolean) to anon, authenticated;
