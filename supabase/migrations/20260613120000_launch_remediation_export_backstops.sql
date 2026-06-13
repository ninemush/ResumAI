create unique index if not exists applications_one_per_user_job_ingestion_idx
on public.applications(user_id, job_ingestion_id)
where job_ingestion_id is not null;

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
        and gr.export_status = 'export_validated'
        and gr.export_validated_at is not null
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
        and gcl.export_status = 'export_validated'
        and gcl.export_validated_at is not null
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

/*
  Rollback:
  - Drop applications_one_per_user_job_ingestion_idx if duplicate application
    creation must temporarily reopen during incident response.
  - Re-apply the prior update_application_status function from
    20260612133000_launch_gap_closure_controls.sql only as a forward-fix
    emergency rollback, because weakening export validation can expose
    unvalidated generated materials as submitted application evidence.
*/
