create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_roles
    where user_id = auth.uid()
      and role = 'owner'
  );
$$;

drop policy if exists "admins can manage admin roles" on public.admin_roles;
drop policy if exists "owners can insert admin roles" on public.admin_roles;
drop policy if exists "owners can update admin roles" on public.admin_roles;
drop policy if exists "owners can delete admin roles" on public.admin_roles;

create policy "owners can insert admin roles"
on public.admin_roles for insert
to authenticated
with check (public.is_owner());

create policy "owners can update admin roles"
on public.admin_roles for update
to authenticated
using (public.is_owner())
with check (public.is_owner());

create policy "owners can delete admin roles"
on public.admin_roles for delete
to authenticated
using (public.is_owner());

create table if not exists public.credit_operation_outputs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null,
  operation_key text not null,
  reservation_id uuid references public.credit_reservations(id) on delete set null,
  ledger_event_id uuid references public.credit_ledger(id) on delete set null,
  resource_type text not null,
  resource_id uuid,
  output_ids jsonb not null default '{}'::jsonb,
  status text not null default 'succeeded',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, feature, operation_key),
  constraint credit_operation_outputs_status_check
    check (status in ('pending', 'succeeded', 'failed', 'ignored', 'reversed'))
);

create index if not exists credit_operation_outputs_user_feature_idx
on public.credit_operation_outputs(user_id, feature, created_at desc);

create index if not exists credit_operation_outputs_reservation_idx
on public.credit_operation_outputs(reservation_id);

create index if not exists credit_operation_outputs_ledger_idx
on public.credit_operation_outputs(ledger_event_id);

create trigger credit_operation_outputs_set_updated_at
before update on public.credit_operation_outputs
for each row execute function public.set_updated_at();

alter table public.credit_operation_outputs enable row level security;

drop policy if exists "users can read own credit operation outputs" on public.credit_operation_outputs;
create policy "users can read own credit operation outputs"
on public.credit_operation_outputs for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "users can insert own credit operation outputs" on public.credit_operation_outputs;
create policy "users can insert own credit operation outputs"
on public.credit_operation_outputs for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "users can update own pending credit operation outputs" on public.credit_operation_outputs;
create policy "users can update own pending credit operation outputs"
on public.credit_operation_outputs for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "admins can read credit operation outputs" on public.credit_operation_outputs;
create policy "admins can read credit operation outputs"
on public.credit_operation_outputs for select
to authenticated
using (public.is_admin());

drop policy if exists "admins can manage credit operation outputs" on public.credit_operation_outputs;
create policy "admins can manage credit operation outputs"
on public.credit_operation_outputs for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create table if not exists public.credit_reversals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  original_ledger_event_id uuid references public.credit_ledger(id) on delete set null,
  reversal_ledger_event_id uuid references public.credit_ledger(id) on delete set null,
  provider_reference text,
  reason text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  user_notice_sent boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.credit_reversals enable row level security;

drop policy if exists "users can read own credit reversals" on public.credit_reversals;
create policy "users can read own credit reversals"
on public.credit_reversals for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "admins can manage credit reversals" on public.credit_reversals;
create policy "admins can manage credit reversals"
on public.credit_reversals for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create or replace function public.cleanup_stale_credit_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  update public.credit_reservations
  set
    status = 'expired',
    metadata = metadata || jsonb_build_object('expired_by_cleanup_at', now())
  where status = 'reserved'
    and expires_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.cleanup_stale_credit_reservations() from public;
grant execute on function public.cleanup_stale_credit_reservations() to authenticated;

create or replace function public.update_application_status(
  p_application_id uuid,
  p_new_status public.application_status,
  p_source text default 'ui',
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  company_name text,
  job_title text,
  job_url text,
  status public.application_status
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_application public.applications%rowtype;
  v_previous_status public.application_status;
  v_has_resume_packet boolean;
  v_has_cover_letter_packet boolean;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select app.*
  into v_application
  from public.applications app
  where app.id = p_application_id
    and app.user_id = auth.uid()
  for update;

  if not found then
    raise exception 'APPLICATION_NOT_FOUND';
  end if;

  if p_new_status = 'applied' then
    select exists (
      select 1
      from public.generated_resumes gr
      where gr.application_id = p_application_id
        and gr.user_id = auth.uid()
        and gr.status = 'ready'
        and gr.pdf_storage_path is not null
        and gr.docx_storage_path is not null
    )
    into v_has_resume_packet;

    select exists (
      select 1
      from public.generated_cover_letters gcl
      where gcl.application_id = p_application_id
        and gcl.user_id = auth.uid()
        and gcl.status = 'ready'
        and gcl.pdf_storage_path is not null
        and gcl.docx_storage_path is not null
    )
    into v_has_cover_letter_packet;

    if not v_has_resume_packet or not v_has_cover_letter_packet then
      raise exception 'FINAL_MATERIALS_REQUIRED';
    end if;
  end if;

  if v_application.status <> p_new_status then
    v_previous_status := v_application.status;

    update public.applications app
    set status = p_new_status,
        updated_at = now()
    where app.id = p_application_id
      and app.user_id = auth.uid()
    returning app.* into v_application;

    insert into public.application_status_events (
      user_id,
      application_id,
      previous_status,
      new_status,
      source,
      metadata
    )
    values (
      auth.uid(),
      p_application_id,
      v_previous_status,
      p_new_status,
      coalesce(p_source, 'ui'),
      coalesce(p_metadata, '{}'::jsonb)
    );
  end if;

  return query
  select
    v_application.id,
    v_application.company_name,
    v_application.job_title,
    v_application.job_url,
    v_application.status;
end;
$$;

revoke all on function public.update_application_status(
  uuid,
  public.application_status,
  text,
  jsonb
) from public;

grant execute on function public.update_application_status(
  uuid,
  public.application_status,
  text,
  jsonb
) to authenticated;
