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
    )
    into v_has_resume_pdf;

    select exists (
      select 1
      from public.generated_cover_letters gcl
      where gcl.application_id = p_application_id
        and gcl.user_id = auth.uid()
        and gcl.status = 'ready'
        and gcl.pdf_storage_path is not null
    )
    into v_has_cover_letter_pdf;

    if not v_has_resume_pdf or not v_has_cover_letter_pdf then
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

create or replace function public.backfill_historical_credit_usage(
  p_user_id uuid default null,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_backfill_version text := '2026-06-03-v1';
  v_candidate_rows integer := 0;
  v_estimated_credits integer := 0;
  v_inserted_rows integer := 0;
  v_summary jsonb := '{}'::jsonb;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  drop table if exists pg_temp._historical_credit_backfill_candidates;
  create temp table pg_temp._historical_credit_backfill_candidates (
    user_id uuid not null,
    event_type text not null,
    credit_delta integer not null,
    resource_type text not null,
    resource_id uuid not null,
    metadata jsonb not null,
    created_at timestamptz not null
  ) on commit drop;

  insert into pg_temp._historical_credit_backfill_candidates (
    user_id,
    event_type,
    credit_delta,
    resource_type,
    resource_id,
    metadata,
    created_at
  )
  select
    ps.user_id,
    'historical_feature_profileSourceExtract',
    -1,
    'profile_source',
    ps.id,
    jsonb_strip_nulls(jsonb_build_object(
      'estimated', true,
      'historicalBackfill', true,
      'backfillVersion', v_backfill_version,
      'basis', 'Successful profile source extraction existed before credit ledger enforcement.',
      'sourceType', ps.source_type,
      'originalFilename', ps.original_filename,
      'mimeType', ps.mime_type
    )),
    coalesce(ps.updated_at, ps.created_at, now())
  from public.profile_sources ps
  where (p_user_id is null or ps.user_id = p_user_id)
    and ps.extraction_status = 'succeeded'
    and length(trim(coalesce(ps.extracted_text, ''))) > 0
    and not exists (
      select 1
      from public.credit_ledger cl
      where cl.user_id = ps.user_id
        and cl.resource_type = 'profile_source'
        and cl.resource_id = ps.id
        and cl.credit_delta < 0
    );

  insert into pg_temp._historical_credit_backfill_candidates (
    user_id,
    event_type,
    credit_delta,
    resource_type,
    resource_id,
    metadata,
    created_at
  )
  select
    ji.user_id,
    'historical_feature_jobIngest',
    -1,
    'job_ingestion',
    ji.id,
    jsonb_strip_nulls(jsonb_build_object(
      'estimated', true,
      'historicalBackfill', true,
      'backfillVersion', v_backfill_version,
      'basis', 'Successful job post ingestion existed before credit ledger enforcement.',
      'title', ji.title,
      'company', ji.company,
      'jobUrl', ji.job_url
    )),
    coalesce(ji.updated_at, ji.created_at, now())
  from public.job_ingestions ji
  where (p_user_id is null or ji.user_id = p_user_id)
    and ji.ingestion_status = 'succeeded'
    and not exists (
      select 1
      from public.credit_ledger cl
      where cl.user_id = ji.user_id
        and cl.resource_type = 'job_ingestion'
        and cl.resource_id = ji.id
        and cl.credit_delta < 0
    );

  insert into pg_temp._historical_credit_backfill_candidates (
    user_id,
    event_type,
    credit_delta,
    resource_type,
    resource_id,
    metadata,
    created_at
  )
  select
    gr.user_id,
    'historical_feature_masterResumeGenerate',
    -2,
    'master_resume',
    gr.id,
    jsonb_strip_nulls(jsonb_build_object(
      'estimated', true,
      'historicalBackfill', true,
      'backfillVersion', v_backfill_version,
      'basis', 'Master resume draft existed before credit ledger enforcement.',
      'resumeStatus', gr.status,
      'promptVersion', gr.prompt_version,
      'model', gr.model
    )),
    coalesce(gr.updated_at, gr.created_at, now())
  from public.generated_resumes gr
  where (p_user_id is null or gr.user_id = p_user_id)
    and gr.resume_type = 'master'
    and gr.status <> 'deleted'
    and not exists (
      select 1
      from public.credit_ledger cl
      where cl.user_id = gr.user_id
        and cl.resource_type = 'master_resume'
        and cl.resource_id = gr.id
        and cl.credit_delta < 0
    );

  insert into pg_temp._historical_credit_backfill_candidates (
    user_id,
    event_type,
    credit_delta,
    resource_type,
    resource_id,
    metadata,
    created_at
  )
  select
    gr.user_id,
    'historical_feature_masterResumeExport',
    -1,
    'master_resume_export',
    gr.id,
    jsonb_strip_nulls(jsonb_build_object(
      'estimated', true,
      'historicalBackfill', true,
      'backfillVersion', v_backfill_version,
      'basis', 'Master resume export path existed before credit ledger enforcement.',
      'hasPdf', gr.pdf_storage_path is not null,
      'hasDocx', gr.storage_path is not null
    )),
    coalesce(gr.updated_at, gr.created_at, now())
  from public.generated_resumes gr
  where (p_user_id is null or gr.user_id = p_user_id)
    and gr.resume_type = 'master'
    and gr.status <> 'deleted'
    and (gr.pdf_storage_path is not null or gr.storage_path is not null)
    and not exists (
      select 1
      from public.credit_ledger cl
      where cl.user_id = gr.user_id
        and cl.resource_type = 'master_resume_export'
        and cl.resource_id = gr.id
        and cl.credit_delta < 0
    );

  insert into pg_temp._historical_credit_backfill_candidates (
    user_id,
    event_type,
    credit_delta,
    resource_type,
    resource_id,
    metadata,
    created_at
  )
  select
    app.user_id,
    'historical_feature_applicationMaterialsGenerate',
    -4,
    'application_materials',
    app.id,
    jsonb_strip_nulls(jsonb_build_object(
      'estimated', true,
      'historicalBackfill', true,
      'backfillVersion', v_backfill_version,
      'basis', 'Role-specific resume or cover letter existed before credit ledger enforcement.',
      'companyName', app.company_name,
      'jobTitle', app.job_title
    )),
    coalesce(app.updated_at, app.created_at, now())
  from public.applications app
  where (p_user_id is null or app.user_id = p_user_id)
    and (
      exists (
        select 1
        from public.generated_resumes gr
        where gr.application_id = app.id
          and gr.resume_type = 'application'
          and gr.status <> 'deleted'
      )
      or exists (
        select 1
        from public.generated_cover_letters gcl
        where gcl.application_id = app.id
          and gcl.status <> 'deleted'
      )
    )
    and not exists (
      select 1
      from public.credit_ledger cl
      where cl.user_id = app.user_id
        and cl.resource_type = 'application_materials'
        and cl.resource_id = app.id
        and cl.credit_delta < 0
    );

  insert into pg_temp._historical_credit_backfill_candidates (
    user_id,
    event_type,
    credit_delta,
    resource_type,
    resource_id,
    metadata,
    created_at
  )
  select
    app.user_id,
    'historical_feature_applicationMaterialsExport',
    -1,
    'application_materials_export',
    app.id,
    jsonb_strip_nulls(jsonb_build_object(
      'estimated', true,
      'historicalBackfill', true,
      'backfillVersion', v_backfill_version,
      'basis', 'Role-specific exported file path existed before credit ledger enforcement.',
      'companyName', app.company_name,
      'jobTitle', app.job_title
    )),
    coalesce(app.updated_at, app.created_at, now())
  from public.applications app
  where (p_user_id is null or app.user_id = p_user_id)
    and (
      exists (
        select 1
        from public.generated_resumes gr
        where gr.application_id = app.id
          and gr.resume_type = 'application'
          and gr.status <> 'deleted'
          and (gr.pdf_storage_path is not null or gr.storage_path is not null)
      )
      or exists (
        select 1
        from public.generated_cover_letters gcl
        where gcl.application_id = app.id
          and gcl.status <> 'deleted'
          and gcl.pdf_storage_path is not null
      )
    )
    and not exists (
      select 1
      from public.credit_ledger cl
      where cl.user_id = app.user_id
        and cl.resource_type = 'application_materials_export'
        and cl.resource_id = app.id
        and cl.credit_delta < 0
    );

  select count(*), coalesce(sum(abs(credit_delta)), 0)
  into v_candidate_rows, v_estimated_credits
  from pg_temp._historical_credit_backfill_candidates;

  select coalesce(
    jsonb_object_agg(
      grouped.event_type,
      jsonb_build_object('events', grouped.event_count, 'credits', grouped.credit_count)
    ),
    '{}'::jsonb
  )
  into v_summary
  from (
    select
      event_type,
      count(*) as event_count,
      coalesce(sum(abs(credit_delta)), 0) as credit_count
    from pg_temp._historical_credit_backfill_candidates
    group by event_type
  ) grouped;

  if not p_dry_run then
    perform public.grant_signup_credits_if_missing(backfill_users.user_id)
    from (
      select distinct user_id
      from pg_temp._historical_credit_backfill_candidates
    ) backfill_users;

    insert into public.credit_ledger (
      user_id,
      event_type,
      credit_delta,
      resource_type,
      resource_id,
      metadata,
      created_at
    )
    select
      user_id,
      event_type,
      credit_delta,
      resource_type,
      resource_id,
      metadata,
      created_at
    from pg_temp._historical_credit_backfill_candidates
    order by created_at asc;

    get diagnostics v_inserted_rows = row_count;
  end if;

  return jsonb_build_object(
    'ok', true,
    'dryRun', p_dry_run,
    'backfillVersion', v_backfill_version,
    'candidateRows', v_candidate_rows,
    'insertedRows', v_inserted_rows,
    'estimatedCredits', v_estimated_credits,
    'byEventType', v_summary
  );
end;
$$;

revoke all on function public.backfill_historical_credit_usage(uuid, boolean) from public;
grant execute on function public.backfill_historical_credit_usage(uuid, boolean) to authenticated;
grant execute on function public.backfill_historical_credit_usage(uuid, boolean) to service_role;

create or replace function public.historical_credit_usage_backfill_candidates(
  p_user_id uuid default null,
  p_backfill_version text default '2026-06-03-v1'
)
returns table (
  user_id uuid,
  event_type text,
  credit_delta integer,
  resource_type text,
  resource_id uuid,
  metadata jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ps.user_id,
    'historical_feature_profileSourceExtract'::text as event_type,
    -1::integer as credit_delta,
    'profile_source'::text as resource_type,
    ps.id as resource_id,
    jsonb_strip_nulls(jsonb_build_object(
      'estimated', true,
      'historicalBackfill', true,
      'backfillVersion', p_backfill_version,
      'basis', 'Successful profile source extraction existed before credit ledger enforcement.',
      'sourceType', ps.source_type,
      'originalFilename', ps.original_filename,
      'mimeType', ps.mime_type
    )) as metadata,
    coalesce(ps.updated_at, ps.created_at, now()) as created_at
  from public.profile_sources ps
  where (p_user_id is null or ps.user_id = p_user_id)
    and ps.extraction_status = 'succeeded'
    and length(trim(coalesce(ps.extracted_text, ''))) > 0
    and not exists (
      select 1
      from public.credit_ledger cl
      where cl.user_id = ps.user_id
        and cl.resource_type = 'profile_source'
        and cl.resource_id = ps.id
        and cl.credit_delta < 0
    )

  union all

  select
    ji.user_id,
    'historical_feature_jobIngest'::text,
    -1::integer,
    'job_ingestion'::text,
    ji.id,
    jsonb_strip_nulls(jsonb_build_object(
      'estimated', true,
      'historicalBackfill', true,
      'backfillVersion', p_backfill_version,
      'basis', 'Successful job post ingestion existed before credit ledger enforcement.',
      'title', ji.title,
      'company', ji.company,
      'jobUrl', ji.job_url
    )),
    coalesce(ji.updated_at, ji.created_at, now())
  from public.job_ingestions ji
  where (p_user_id is null or ji.user_id = p_user_id)
    and ji.ingestion_status = 'succeeded'
    and not exists (
      select 1
      from public.credit_ledger cl
      where cl.user_id = ji.user_id
        and cl.resource_type = 'job_ingestion'
        and cl.resource_id = ji.id
        and cl.credit_delta < 0
    )

  union all

  select
    gr.user_id,
    'historical_feature_masterResumeGenerate'::text,
    -2::integer,
    'master_resume'::text,
    gr.id,
    jsonb_strip_nulls(jsonb_build_object(
      'estimated', true,
      'historicalBackfill', true,
      'backfillVersion', p_backfill_version,
      'basis', 'Master resume draft existed before credit ledger enforcement.',
      'resumeStatus', gr.status,
      'promptVersion', gr.prompt_version,
      'model', gr.model
    )),
    coalesce(gr.updated_at, gr.created_at, now())
  from public.generated_resumes gr
  where (p_user_id is null or gr.user_id = p_user_id)
    and gr.resume_type = 'master'
    and gr.status <> 'deleted'
    and not exists (
      select 1
      from public.credit_ledger cl
      where cl.user_id = gr.user_id
        and cl.resource_type = 'master_resume'
        and cl.resource_id = gr.id
        and cl.credit_delta < 0
    )

  union all

  select
    gr.user_id,
    'historical_feature_masterResumeExport'::text,
    -1::integer,
    'master_resume_export'::text,
    gr.id,
    jsonb_strip_nulls(jsonb_build_object(
      'estimated', true,
      'historicalBackfill', true,
      'backfillVersion', p_backfill_version,
      'basis', 'Master resume export path existed before credit ledger enforcement.',
      'hasPdf', gr.pdf_storage_path is not null,
      'hasDocx', gr.storage_path is not null
    )),
    coalesce(gr.updated_at, gr.created_at, now())
  from public.generated_resumes gr
  where (p_user_id is null or gr.user_id = p_user_id)
    and gr.resume_type = 'master'
    and gr.status <> 'deleted'
    and (gr.pdf_storage_path is not null or gr.storage_path is not null)
    and not exists (
      select 1
      from public.credit_ledger cl
      where cl.user_id = gr.user_id
        and cl.resource_type = 'master_resume_export'
        and cl.resource_id = gr.id
        and cl.credit_delta < 0
    )

  union all

  select
    app.user_id,
    'historical_feature_applicationMaterialsGenerate'::text,
    -4::integer,
    'application_materials'::text,
    app.id,
    jsonb_strip_nulls(jsonb_build_object(
      'estimated', true,
      'historicalBackfill', true,
      'backfillVersion', p_backfill_version,
      'basis', 'Role-specific resume or cover letter existed before credit ledger enforcement.',
      'companyName', app.company_name,
      'jobTitle', app.job_title
    )),
    coalesce(app.updated_at, app.created_at, now())
  from public.applications app
  where (p_user_id is null or app.user_id = p_user_id)
    and (
      exists (
        select 1
        from public.generated_resumes gr
        where gr.application_id = app.id
          and gr.resume_type = 'application'
          and gr.status <> 'deleted'
      )
      or exists (
        select 1
        from public.generated_cover_letters gcl
        where gcl.application_id = app.id
          and gcl.status <> 'deleted'
      )
    )
    and not exists (
      select 1
      from public.credit_ledger cl
      where cl.user_id = app.user_id
        and cl.resource_type = 'application_materials'
        and cl.resource_id = app.id
        and cl.credit_delta < 0
    )

  union all

  select
    app.user_id,
    'historical_feature_applicationMaterialsExport'::text,
    -1::integer,
    'application_materials_export'::text,
    app.id,
    jsonb_strip_nulls(jsonb_build_object(
      'estimated', true,
      'historicalBackfill', true,
      'backfillVersion', p_backfill_version,
      'basis', 'Role-specific exported file path existed before credit ledger enforcement.',
      'companyName', app.company_name,
      'jobTitle', app.job_title
    )),
    coalesce(app.updated_at, app.created_at, now())
  from public.applications app
  where (p_user_id is null or app.user_id = p_user_id)
    and (
      exists (
        select 1
        from public.generated_resumes gr
        where gr.application_id = app.id
          and gr.resume_type = 'application'
          and gr.status <> 'deleted'
          and (gr.pdf_storage_path is not null or gr.storage_path is not null)
      )
      or exists (
        select 1
        from public.generated_cover_letters gcl
        where gcl.application_id = app.id
          and gcl.status <> 'deleted'
          and gcl.pdf_storage_path is not null
      )
    )
    and not exists (
      select 1
      from public.credit_ledger cl
      where cl.user_id = app.user_id
        and cl.resource_type = 'application_materials_export'
        and cl.resource_id = app.id
        and cl.credit_delta < 0
    );
$$;

revoke all on function public.historical_credit_usage_backfill_candidates(uuid, text) from public;
revoke all on function public.historical_credit_usage_backfill_candidates(uuid, text) from authenticated;

create or replace function public.backfill_historical_credit_usage(
  p_user_id uuid default null,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_backfill_version text := '2026-06-03-v1';
  v_candidate_rows integer := 0;
  v_estimated_credits integer := 0;
  v_inserted_rows integer := 0;
  v_summary jsonb := '{}'::jsonb;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select count(*), coalesce(sum(abs(candidates.credit_delta)), 0)
  into v_candidate_rows, v_estimated_credits
  from public.historical_credit_usage_backfill_candidates(p_user_id, v_backfill_version) candidates;

  select coalesce(
    jsonb_object_agg(
      grouped.event_type,
      jsonb_build_object('events', grouped.event_count, 'credits', grouped.credit_count)
    ),
    '{}'::jsonb
  )
  into v_summary
  from (
    select
      candidates.event_type,
      count(*) as event_count,
      coalesce(sum(abs(candidates.credit_delta)), 0) as credit_count
    from public.historical_credit_usage_backfill_candidates(p_user_id, v_backfill_version) candidates
    group by candidates.event_type
  ) grouped;

  if not p_dry_run then
    perform public.grant_signup_credits_if_missing(backfill_users.user_id)
    from (
      select distinct candidates.user_id
      from public.historical_credit_usage_backfill_candidates(p_user_id, v_backfill_version) candidates
    ) backfill_users;

    insert into public.credit_ledger (
      user_id,
      event_type,
      credit_delta,
      resource_type,
      resource_id,
      metadata,
      created_at
    )
    select
      candidates.user_id,
      candidates.event_type,
      candidates.credit_delta,
      candidates.resource_type,
      candidates.resource_id,
      candidates.metadata,
      candidates.created_at
    from public.historical_credit_usage_backfill_candidates(p_user_id, v_backfill_version) candidates
    order by candidates.created_at asc;

    get diagnostics v_inserted_rows = row_count;
  end if;

  return jsonb_build_object(
    'ok', true,
    'dryRun', p_dry_run,
    'backfillVersion', v_backfill_version,
    'candidateRows', v_candidate_rows,
    'insertedRows', v_inserted_rows,
    'estimatedCredits', v_estimated_credits,
    'byEventType', v_summary
  );
end;
$$;

revoke all on function public.backfill_historical_credit_usage(uuid, boolean) from public;
grant execute on function public.backfill_historical_credit_usage(uuid, boolean) to authenticated;
grant execute on function public.backfill_historical_credit_usage(uuid, boolean) to service_role;
