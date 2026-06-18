-- Forward hardening for paid and quota-protected operation idempotency.
-- Existing reserved/finalized rows with null fingerprints remain retry-compatible
-- in the reservation RPCs, but new reservations after this migration must carry
-- a server-computed operation fingerprint.

create or replace function public.require_credit_reservation_fingerprint()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.operation_fingerprint is null
    and (
      tg_op = 'INSERT'
      or (
        tg_op = 'UPDATE'
        and old.status in ('released', 'expired')
        and new.status = 'reserved'
      )
    )
  then
    raise exception 'CREDIT_OPERATION_FINGERPRINT_REQUIRED';
  end if;

  return new;
end;
$$;

drop trigger if exists credit_reservations_require_operation_fingerprint
on public.credit_reservations;

create trigger credit_reservations_require_operation_fingerprint
before insert or update on public.credit_reservations
for each row execute function public.require_credit_reservation_fingerprint();

create or replace function public.require_quota_reservation_fingerprint()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.operation_fingerprint is null
    and (
      tg_op = 'INSERT'
      or (
        tg_op = 'UPDATE'
        and old.status in ('released', 'expired')
        and new.status = 'reserved'
      )
    )
  then
    raise exception 'QUOTA_OPERATION_FINGERPRINT_REQUIRED';
  end if;

  return new;
end;
$$;

drop trigger if exists quota_reservations_require_operation_fingerprint
on public.quota_reservations;

create trigger quota_reservations_require_operation_fingerprint
before insert or update on public.quota_reservations
for each row execute function public.require_quota_reservation_fingerprint();
