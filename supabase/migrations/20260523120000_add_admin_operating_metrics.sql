create or replace function public.get_admin_operating_metrics()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_metrics jsonb;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select jsonb_build_object(
    'users', jsonb_build_object(
      'totalSignedUp', (select count(*) from auth.users),
      'active7d', (
        select count(*)
        from auth.users
        where last_sign_in_at >= now() - interval '7 days'
      ),
      'active30d', (
        select count(*)
        from auth.users
        where last_sign_in_at >= now() - interval '30 days'
      )
    ),
    'profiles', jsonb_build_object(
      'created', (select count(*) from public.profiles),
      'ready', (select count(*) from public.profiles where profile_status = 'ready'),
      'needsReview', (select count(*) from public.profiles where profile_status = 'needs_review'),
      'draft', (select count(*) from public.profiles where profile_status = 'draft')
    ),
    'sources', coalesce((
      select jsonb_object_agg(source_type, source_count)
      from (
        select source_type::text, count(*) as source_count
        from public.profile_sources
        group by source_type
      ) source_counts
    ), '{}'::jsonb),
    'jobs', jsonb_build_object(
      'ingested', (select count(*) from public.job_ingestions),
      'succeeded', (select count(*) from public.job_ingestions where ingestion_status = 'succeeded'),
      'failed', (select count(*) from public.job_ingestions where ingestion_status = 'failed')
    ),
    'applications', jsonb_build_object(
      'logged', (select count(*) from public.applications),
      'converted', (
        select count(*)
        from public.applications
        where status = 'interviewed_selected'
      ),
      'byStatus', coalesce((
        select jsonb_object_agg(status, status_count)
        from (
          select status::text, count(*) as status_count
          from public.applications
          group by status
        ) status_counts
      ), '{}'::jsonb)
    ),
    'materials', jsonb_build_object(
      'generatedResumes', (select count(*) from public.generated_resumes),
      'generatedCoverLetters', (select count(*) from public.generated_cover_letters),
      'resumePdfs', (
        select count(*)
        from public.generated_resumes
        where pdf_storage_path is not null
      ),
      'coverLetterPdfs', (
        select count(*)
        from public.generated_cover_letters
        where pdf_storage_path is not null
      )
    ),
    'featureUsage', coalesce((
      select jsonb_object_agg(event_type, event_count)
      from (
        select event_type::text, count(*) as event_count
        from public.quota_events
        group by event_type
      ) event_counts
    ), '{}'::jsonb),
    'systemHealth', jsonb_build_object(
      'jobIngestionFailures', (
        select count(*)
        from public.job_ingestions
        where ingestion_status = 'failed'
      ),
      'profileExtractionFailures', (
        select count(*)
        from public.profile_sources
        where extraction_status = 'failed'
      )
    ),
    'support', jsonb_build_object(
      'ticketsOpen', 0,
      'ticketsEscalated', 0,
      'l1Resolved', 0,
      'status', 'not_configured'
    ),
    'generatedAt', now()
  )
  into v_metrics;

  return v_metrics;
end;
$$;

revoke all on function public.get_admin_operating_metrics() from public;
grant execute on function public.get_admin_operating_metrics() to authenticated;
