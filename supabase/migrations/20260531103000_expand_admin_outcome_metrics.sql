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
    'outcomes', jsonb_build_object(
      'interviewRate', coalesce((
        select round(
          count(*) filter (
            where status in ('interview_in_progress', 'interviewed_not_selected', 'interviewed_selected')
          )::numeric / nullif(count(*), 0),
          4
        )
        from public.applications
      ), 0),
      'selectionRate', coalesce((
        select round(
          count(*) filter (where status = 'interviewed_selected')::numeric / nullif(count(*), 0),
          4
        )
        from public.applications
      ), 0),
      'rejectionRate', coalesce((
        select round(
          count(*) filter (
            where status in ('rejected', 'interviewed_not_selected', 'withdrawn')
          )::numeric / nullif(count(*), 0),
          4
        )
        from public.applications
      ), 0),
      'averageHoursToFirstResponse', coalesce((
        select round(avg(extract(epoch from first_response_at - created_at) / 3600)::numeric, 2)
        from (
          select
            applications.created_at,
            min(application_status_events.created_at) filter (
              where application_status_events.new_status not in ('draft', 'applied', 'no_reply')
            ) as first_response_at
          from public.applications
          left join public.application_status_events
            on application_status_events.application_id = applications.id
          group by applications.id
        ) response_times
        where first_response_at is not null
      ), 0),
      'byTier', coalesce((
        select jsonb_object_agg(tier_name, metrics)
        from (
          select
            coalesce(tiers.name, 'No active tier') as tier_name,
            jsonb_build_object(
              'applications', count(applications.id),
              'selected', count(applications.id) filter (where applications.status = 'interviewed_selected'),
              'interviewRate', coalesce(round(
                count(applications.id) filter (
                  where applications.status in ('interview_in_progress', 'interviewed_not_selected', 'interviewed_selected')
                )::numeric / nullif(count(applications.id), 0),
                4
              ), 0)
            ) as metrics
          from public.applications
          left join public.user_tiers
            on user_tiers.user_id = applications.user_id
           and user_tiers.status = 'active'
          left join public.tiers
            on tiers.id = user_tiers.tier_id
          group by coalesce(tiers.name, 'No active tier')
        ) tier_metrics
      ), '{}'::jsonb),
      'byRoleFamily', coalesce((
        select jsonb_object_agg(role_family, metrics)
        from (
          select
            coalesce(nullif(profiles.target_direction, ''), 'Unspecified') as role_family,
            jsonb_build_object(
              'applications', count(applications.id),
              'selected', count(applications.id) filter (where applications.status = 'interviewed_selected'),
              'interviewRate', coalesce(round(
                count(applications.id) filter (
                  where applications.status in ('interview_in_progress', 'interviewed_not_selected', 'interviewed_selected')
                )::numeric / nullif(count(applications.id), 0),
                4
              ), 0)
            ) as metrics
          from public.applications
          join public.profiles
            on profiles.id = applications.profile_id
          group by coalesce(nullif(profiles.target_direction, ''), 'Unspecified')
        ) role_metrics
      ), '{}'::jsonb),
      'bySourceType', coalesce((
        select jsonb_object_agg(source_type, metrics)
        from (
          select
            coalesce(profile_sources.source_type::text, 'unknown') as source_type,
            jsonb_build_object(
              'users', count(distinct profiles.user_id),
              'applications', count(distinct applications.id),
              'selected', count(distinct applications.id) filter (where applications.status = 'interviewed_selected')
            ) as metrics
          from public.profile_sources
          join public.profiles
            on profiles.id = profile_sources.profile_id
          left join public.applications
            on applications.profile_id = profiles.id
          group by coalesce(profile_sources.source_type::text, 'unknown')
        ) source_metrics
      ), '{}'::jsonb),
      'byResumeType', coalesce((
        select jsonb_object_agg(resume_type, metrics)
        from (
          select
            generated_resumes.resume_type::text as resume_type,
            jsonb_build_object(
              'resumes', count(generated_resumes.id),
              'applications', count(distinct applications.id),
              'selected', count(distinct applications.id) filter (where applications.status = 'interviewed_selected')
            ) as metrics
          from public.generated_resumes
          left join public.applications
            on applications.id = generated_resumes.application_id
          group by generated_resumes.resume_type
        ) resume_metrics
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
