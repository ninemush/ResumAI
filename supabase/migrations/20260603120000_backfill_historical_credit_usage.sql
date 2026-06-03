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
  create temp table _historical_credit_backfill_candidates (
    user_id uuid not null,
    event_type text not null,
    credit_delta integer not null,
    resource_type text not null,
    resource_id uuid not null,
    metadata jsonb not null,
    created_at timestamptz not null
  ) on commit drop;

  insert into _historical_credit_backfill_candidates (
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

  insert into _historical_credit_backfill_candidates (
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

  insert into _historical_credit_backfill_candidates (
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

  insert into _historical_credit_backfill_candidates (
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

  insert into _historical_credit_backfill_candidates (
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

  insert into _historical_credit_backfill_candidates (
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
  from _historical_credit_backfill_candidates;

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
    from _historical_credit_backfill_candidates
    group by event_type
  ) grouped;

  if not p_dry_run then
    perform public.grant_signup_credits_if_missing(backfill_users.user_id)
    from (
      select distinct user_id
      from _historical_credit_backfill_candidates
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
    from _historical_credit_backfill_candidates
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

select public.backfill_historical_credit_usage(null, false);
