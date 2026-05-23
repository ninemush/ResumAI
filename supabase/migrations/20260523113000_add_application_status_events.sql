create table public.application_status_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  application_id uuid not null references public.applications(id) on delete restrict,
  previous_status public.application_status,
  new_status public.application_status not null,
  source text not null default 'user',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index application_status_events_user_id_idx
on public.application_status_events(user_id);

create index application_status_events_application_id_idx
on public.application_status_events(application_id);

alter table public.application_status_events enable row level security;

create policy "users can read own application status events"
on public.application_status_events for select
to authenticated
using (auth.uid() = user_id or public.is_admin());

create policy "users can insert own application status events"
on public.application_status_events for insert
to authenticated
with check (auth.uid() = user_id);

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
  v_has_resume_pdf boolean;
  v_has_cover_letter_pdf boolean;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
  into v_application
  from public.applications
  where applications.id = p_application_id
    and applications.user_id = auth.uid()
  for update;

  if not found then
    raise exception 'APPLICATION_NOT_FOUND';
  end if;

  if p_new_status = 'applied' then
    select exists (
      select 1
      from public.generated_resumes
      where application_id = p_application_id
        and user_id = auth.uid()
        and status = 'ready'
        and pdf_storage_path is not null
    )
    into v_has_resume_pdf;

    select exists (
      select 1
      from public.generated_cover_letters
      where application_id = p_application_id
        and user_id = auth.uid()
        and status = 'ready'
        and pdf_storage_path is not null
    )
    into v_has_cover_letter_pdf;

    if not v_has_resume_pdf or not v_has_cover_letter_pdf then
      raise exception 'FINAL_MATERIALS_REQUIRED';
    end if;
  end if;

  if v_application.status <> p_new_status then
    v_previous_status := v_application.status;

    update public.applications
    set status = p_new_status,
        updated_at = now()
    where applications.id = p_application_id
      and applications.user_id = auth.uid()
    returning * into v_application;

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
