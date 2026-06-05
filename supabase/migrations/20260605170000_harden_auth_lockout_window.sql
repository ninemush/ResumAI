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
  update public.auth_login_lockouts
    set failed_attempts = 0,
        locked_until = null,
        last_failed_at = null,
        updated_at = now()
    where email_hash = v_hash
      and (
        (locked_until is not null and locked_until <= now())
        or (locked_until is null and last_failed_at is not null and last_failed_at <= now() - interval '15 minutes')
      );

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
  v_record public.auth_login_lockouts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_hash, 0));

  if was_successful then
    delete from public.auth_login_lockouts where email_hash = v_hash;

    return jsonb_build_object(
      'allowed', true,
      'failedAttempts', 0,
      'lockedUntil', null
    );
  end if;

  update public.auth_login_lockouts
    set failed_attempts = 0,
        locked_until = null,
        last_failed_at = null,
        updated_at = now()
    where email_hash = v_hash
      and (
        (locked_until is not null and locked_until <= now())
        or (locked_until is null and last_failed_at is not null and last_failed_at <= now() - interval '15 minutes')
      );

  select *
    into v_record
    from public.auth_login_lockouts
    where email_hash = v_hash
    for update;

  if found and v_record.locked_until is not null and v_record.locked_until > now() then
    return jsonb_build_object(
      'allowed', false,
      'failedAttempts', v_record.failed_attempts,
      'lockedUntil', v_record.locked_until
    );
  end if;

  v_attempts := coalesce(v_record.failed_attempts, 0) + 1;
  v_locked_until := case
    when v_attempts >= 3 then now() + interval '15 minutes'
    else null
  end;

  insert into public.auth_login_lockouts (
    email_hash,
    failed_attempts,
    locked_until,
    last_failed_at,
    updated_at
  )
  values (
    v_hash,
    v_attempts,
    v_locked_until,
    now(),
    now()
  )
  on conflict (email_hash)
  do update set
    failed_attempts = excluded.failed_attempts,
    locked_until = excluded.locked_until,
    last_failed_at = excluded.last_failed_at,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'allowed', v_locked_until is null,
    'failedAttempts', v_attempts,
    'lockedUntil', v_locked_until
  );
end;
$$;

grant execute on function public.check_password_login_allowed(text) to anon, authenticated;
grant execute on function public.record_password_login_attempt(text, boolean) to anon, authenticated;

comment on function public.record_password_login_attempt(text, boolean) is
  'Tracks password-login failures by email hash, serializes updates per account, and resets stale counters after the lockout window.';
