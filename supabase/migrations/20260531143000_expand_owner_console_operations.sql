create table if not exists public.app_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  page text,
  feature text,
  duration_seconds numeric(10, 2),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (event_type <> ''),
  check (duration_seconds is null or duration_seconds >= 0)
);

create table if not exists public.error_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  area text not null default 'unknown',
  severity text not null default 'medium',
  error_code text not null,
  message text not null default '',
  root_cause_category text not null default 'needs_triage',
  rationale text not null default '',
  fix_required boolean not null default true,
  resolved_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (severity in ('low', 'medium', 'high', 'critical')),
  check (error_code <> '')
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  status text not null default 'open',
  priority text not null default 'normal',
  sentiment text not null default 'unknown',
  subject text not null,
  summary text not null default '',
  l1_disposition text not null default 'not_started',
  escalated_to_l2 boolean not null default false,
  escalation_reason text,
  resolved_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('open', 'waiting_on_user', 'in_progress', 'resolved', 'closed', 'escalated')),
  check (priority in ('low', 'normal', 'high', 'urgent')),
  check (sentiment in ('positive', 'neutral', 'frustrated', 'angry', 'unknown')),
  check (subject <> '')
);

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  speaker text not null,
  message text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (speaker in ('user', 'assistant', 'admin', 'system')),
  check (message <> '')
);

create index if not exists app_events_user_created_idx
on public.app_events(user_id, created_at desc);

create index if not exists app_events_type_created_idx
on public.app_events(event_type, created_at desc);

create index if not exists app_events_page_created_idx
on public.app_events(page, created_at desc);

create index if not exists error_events_created_idx
on public.error_events(created_at desc);

create index if not exists error_events_user_created_idx
on public.error_events(user_id, created_at desc);

create index if not exists error_events_root_cause_idx
on public.error_events(root_cause_category, fix_required);

create index if not exists support_tickets_status_idx
on public.support_tickets(status, created_at desc);

create index if not exists support_tickets_user_idx
on public.support_tickets(user_id, created_at desc);

create index if not exists support_ticket_messages_ticket_idx
on public.support_ticket_messages(ticket_id, created_at);

drop trigger if exists support_tickets_set_updated_at on public.support_tickets;
create trigger support_tickets_set_updated_at
before update on public.support_tickets
for each row execute function public.set_updated_at();

alter table public.app_events enable row level security;
alter table public.error_events enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;

drop policy if exists "users can insert own app events" on public.app_events;
create policy "users can insert own app events"
on public.app_events for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "admins can read app events" on public.app_events;
create policy "admins can read app events"
on public.app_events for select
to authenticated
using (public.is_admin());

drop policy if exists "users can insert own error events" on public.error_events;
create policy "users can insert own error events"
on public.error_events for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "admins can read error events" on public.error_events;
create policy "admins can read error events"
on public.error_events for select
to authenticated
using (public.is_admin());

drop policy if exists "users can create own support tickets" on public.support_tickets;
create policy "users can create own support tickets"
on public.support_tickets for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "users can read own support tickets" on public.support_tickets;
create policy "users can read own support tickets"
on public.support_tickets for select
to authenticated
using (auth.uid() = user_id or public.is_admin());

drop policy if exists "admins can manage support tickets" on public.support_tickets;
create policy "admins can manage support tickets"
on public.support_tickets for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "users can create own support messages" on public.support_ticket_messages;
create policy "users can create own support messages"
on public.support_ticket_messages for insert
to authenticated
with check (
  auth.uid() = user_id
  and exists (
    select 1
    from public.support_tickets
    where support_tickets.id = support_ticket_messages.ticket_id
      and support_tickets.user_id = auth.uid()
  )
);

drop policy if exists "users can read own support messages" on public.support_ticket_messages;
create policy "users can read own support messages"
on public.support_ticket_messages for select
to authenticated
using (
  public.is_admin()
  or exists (
    select 1
    from public.support_tickets
    where support_tickets.id = support_ticket_messages.ticket_id
      and support_tickets.user_id = auth.uid()
  )
);

create or replace function public.get_admin_operating_metrics(p_period_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_metrics jsonb;
  v_period_days integer := greatest(1, least(coalesce(p_period_days, 30), 365));
  v_period_start timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_period_days, 30), 365)));
begin
  if not public.is_admin() then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select jsonb_build_object(
    'period', jsonb_build_object(
      'days', v_period_days,
      'startedAt', v_period_start,
      'endedAt', now()
    ),
    'users', jsonb_build_object(
      'totalSignedUp', (select count(*) from auth.users),
      'newInPeriod', (
        select count(*)
        from auth.users
        where created_at >= v_period_start
      ),
      'activeInPeriod', (
        select count(distinct user_id)
        from public.app_events
        where created_at >= v_period_start
          and user_id is not null
      ),
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
        where created_at >= v_period_start
        group by source_type
      ) source_counts
    ), '{}'::jsonb),
    'jobs', jsonb_build_object(
      'ingested', (select count(*) from public.job_ingestions where created_at >= v_period_start),
      'succeeded', (
        select count(*)
        from public.job_ingestions
        where created_at >= v_period_start
          and ingestion_status = 'succeeded'
      ),
      'failed', (
        select count(*)
        from public.job_ingestions
        where created_at >= v_period_start
          and ingestion_status = 'failed'
      )
    ),
    'applications', jsonb_build_object(
      'logged', (select count(*) from public.applications where created_at >= v_period_start),
      'converted', (
        select count(*)
        from public.applications
        where created_at >= v_period_start
          and status = 'interviewed_selected'
      ),
      'byStatus', coalesce((
        select jsonb_object_agg(status, status_count)
        from (
          select status::text, count(*) as status_count
          from public.applications
          where created_at >= v_period_start
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
        where created_at >= v_period_start
      ), 0),
      'selectionRate', coalesce((
        select round(
          count(*) filter (where status = 'interviewed_selected')::numeric / nullif(count(*), 0),
          4
        )
        from public.applications
        where created_at >= v_period_start
      ), 0),
      'rejectionRate', coalesce((
        select round(
          count(*) filter (
            where status in ('rejected', 'interviewed_not_selected', 'withdrawn')
          )::numeric / nullif(count(*), 0),
          4
        )
        from public.applications
        where created_at >= v_period_start
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
          where applications.created_at >= v_period_start
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
          where applications.created_at >= v_period_start
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
          where applications.created_at >= v_period_start
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
          where profile_sources.created_at >= v_period_start
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
          where generated_resumes.created_at >= v_period_start
          group by generated_resumes.resume_type
        ) resume_metrics
      ), '{}'::jsonb)
    ),
    'materials', jsonb_build_object(
      'generatedResumes', (select count(*) from public.generated_resumes where created_at >= v_period_start),
      'generatedCoverLetters', (select count(*) from public.generated_cover_letters where created_at >= v_period_start),
      'resumePdfs', (
        select count(*)
        from public.generated_resumes
        where created_at >= v_period_start
          and pdf_storage_path is not null
      ),
      'coverLetterPdfs', (
        select count(*)
        from public.generated_cover_letters
        where created_at >= v_period_start
          and pdf_storage_path is not null
      )
    ),
    'featureUsage', coalesce((
      select jsonb_object_agg(event_type, event_count)
      from (
        select event_type::text, count(*) as event_count
        from (
          select event_type::text
          from public.quota_events
          where created_at >= v_period_start
          union all
          select coalesce(feature, event_type)::text
          from public.app_events
          where created_at >= v_period_start
            and event_type not in ('page_view', 'page_time')
        ) usage_events
        group by event_type
      ) event_counts
    ), '{}'::jsonb),
    'systemHealth', jsonb_build_object(
      'jobIngestionFailures', (
        select count(*)
        from public.job_ingestions
        where created_at >= v_period_start
          and ingestion_status = 'failed'
      ),
      'profileExtractionFailures', (
        select count(*)
        from public.profile_sources
        where created_at >= v_period_start
          and extraction_status = 'failed'
      ),
      'clientErrors', (
        select count(*)
        from public.error_events
        where created_at >= v_period_start
      ),
      'fixRequired', (
        select count(*)
        from public.error_events
        where created_at >= v_period_start
          and fix_required
          and resolved_at is null
      )
    ),
    'support', jsonb_build_object(
      'ticketsOpen', (
        select count(*)
        from public.support_tickets
        where status in ('open', 'waiting_on_user', 'in_progress', 'escalated')
      ),
      'ticketsEscalated', (
        select count(*)
        from public.support_tickets
        where escalated_to_l2
          and created_at >= v_period_start
      ),
      'l1Resolved', (
        select count(*)
        from public.support_tickets
        where l1_disposition = 'resolved'
          and created_at >= v_period_start
      ),
      'status', 'configured'
    ),
    'trends', jsonb_build_object(
      'daily', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'date', bucket::date,
            'signups', (
              select count(*) from auth.users where created_at::date = bucket::date
            ),
            'activeUsers', (
              select count(distinct user_id)
              from public.app_events
              where created_at::date = bucket::date
                and user_id is not null
            ),
            'pageViews', (
              select count(*)
              from public.app_events
              where created_at::date = bucket::date
                and event_type = 'page_view'
            ),
            'applications', (
              select count(*)
              from public.applications
              where created_at::date = bucket::date
            ),
            'errors', (
              select count(*)
              from public.error_events
              where created_at::date = bucket::date
            ),
            'tickets', (
              select count(*)
              from public.support_tickets
              where created_at::date = bucket::date
            )
          )
        )
        from generate_series(v_period_start::date, now()::date, interval '1 day') bucket
      ), '[]'::jsonb),
      'pageUsage', coalesce((
        select jsonb_agg(row_payload order by total_seconds desc)
        from (
          select
            coalesce(page, 'unknown') as page_name,
            coalesce(round(sum(duration_seconds) filter (where event_type = 'page_time'), 2), 0) as total_seconds,
            jsonb_build_object(
              'page', coalesce(page, 'unknown'),
              'views', count(*) filter (where event_type = 'page_view'),
              'uniqueUsers', count(distinct user_id),
              'totalSeconds', coalesce(round(sum(duration_seconds) filter (where event_type = 'page_time'), 2), 0),
              'averageSeconds', coalesce(round(avg(duration_seconds) filter (where event_type = 'page_time'), 2), 0)
            ) as row_payload
          from public.app_events
          where created_at >= v_period_start
            and event_type in ('page_view', 'page_time')
          group by coalesce(page, 'unknown')
          order by total_seconds desc
          limit 20
        ) page_usage
      ), '[]'::jsonb)
    ),
    'usersList', coalesce((
      select jsonb_agg(row_payload order by last_activity_at desc nulls last)
      from (
        select jsonb_build_object(
          'userId', users.id,
          'email', users.email,
          'displayName', profiles.display_name,
          'createdAt', users.created_at,
          'lastSignInAt', users.last_sign_in_at,
          'lastActivityAt', activity.last_activity_at,
          'tier', coalesce(tiers.name, 'No active tier'),
          'profileStatus', profiles.profile_status,
          'sources', coalesce(source_counts.source_count, 0),
          'applications', coalesce(application_counts.application_count, 0),
          'resumes', coalesce(resume_counts.resume_count, 0),
          'openTickets', coalesce(ticket_counts.open_ticket_count, 0)
        ) as row_payload,
        coalesce(activity.last_activity_at, users.last_sign_in_at, users.created_at) as last_activity_at
        from auth.users users
        left join public.profiles
          on profiles.user_id = users.id
        left join public.user_tiers
          on user_tiers.user_id = users.id
         and user_tiers.status = 'active'
        left join public.tiers
          on tiers.id = user_tiers.tier_id
        left join (
          select user_id, count(*) as source_count
          from public.profile_sources
          group by user_id
        ) source_counts
          on source_counts.user_id = users.id
        left join (
          select user_id, count(*) as application_count
          from public.applications
          group by user_id
        ) application_counts
          on application_counts.user_id = users.id
        left join (
          select user_id, count(*) as resume_count
          from public.generated_resumes
          group by user_id
        ) resume_counts
          on resume_counts.user_id = users.id
        left join (
          select user_id, count(*) as open_ticket_count
          from public.support_tickets
          where status in ('open', 'waiting_on_user', 'in_progress', 'escalated')
          group by user_id
        ) ticket_counts
          on ticket_counts.user_id = users.id
        left join (
          select user_id, max(created_at) as last_activity_at
          from public.app_events
          group by user_id
        ) activity
          on activity.user_id = users.id
        order by coalesce(activity.last_activity_at, users.last_sign_in_at, users.created_at) desc nulls last
        limit 100
      ) users
    ), '[]'::jsonb),
    'errorDetails', coalesce((
      select jsonb_agg(error_payload order by created_at desc)
      from (
        select
          error_events.created_at,
          jsonb_build_object(
            'id', error_events.id,
            'source', 'app_error',
            'createdAt', error_events.created_at,
            'userEmail', users.email,
            'area', error_events.area,
            'severity', error_events.severity,
            'summary', error_events.message,
            'code', error_events.error_code,
            'rootCause', error_events.root_cause_category,
            'rationale', error_events.rationale,
            'fixRequired', error_events.fix_required,
            'status', case when error_events.resolved_at is null then 'open' else 'resolved' end
          ) as error_payload
        from public.error_events
        left join auth.users users
          on users.id = error_events.user_id
        where error_events.created_at >= v_period_start
        union all
        select
          profile_sources.updated_at as created_at,
          jsonb_build_object(
            'id', profile_sources.id,
            'source', 'profile_source',
            'createdAt', profile_sources.updated_at,
            'userEmail', users.email,
            'area', 'profile_intake',
            'severity', case
              when profile_sources.failure_reason ilike '%provider%' then 'high'
              else 'medium'
            end,
            'summary', coalesce(profile_sources.original_filename, profile_sources.source_url, profile_sources.source_type::text),
            'code', coalesce(profile_sources.failure_reason, 'PROFILE_SOURCE_FAILED'),
            'rootCause', case
              when profile_sources.failure_reason ilike '%UNSUPPORTED%' then 'unsupported_input'
              when profile_sources.failure_reason ilike '%TOO_LARGE%' or profile_sources.failure_reason ilike '%LIMIT%' then 'input_limit'
              when profile_sources.failure_reason ilike '%EMPTY%' or profile_sources.failure_reason ilike '%TOO_SHORT%' then 'source_quality'
              when profile_sources.failure_reason ilike '%BLOCKED%' then 'third_party_blocked'
              when profile_sources.failure_reason ilike '%PROVIDER%' then 'provider_failure'
              else 'needs_triage'
            end,
            'rationale', case
              when profile_sources.failure_reason ilike '%UNSUPPORTED%' then 'The user supplied a file or link type the current intake pipeline does not support reliably.'
              when profile_sources.failure_reason ilike '%TOO_LARGE%' or profile_sources.failure_reason ilike '%LIMIT%' then 'The source exceeded current processing limits and needs either clearer guidance or a higher-capacity worker.'
              when profile_sources.failure_reason ilike '%EMPTY%' or profile_sources.failure_reason ilike '%TOO_SHORT%' then 'The source was readable but did not contain enough extractable profile text.'
              when profile_sources.failure_reason ilike '%BLOCKED%' then 'The third-party page did not expose enough public content to the ingestion service.'
              when profile_sources.failure_reason ilike '%PROVIDER%' then 'The external AI/OCR/provider call failed after retrying and should be monitored for recurrence.'
              else 'The failure is not yet classified and needs an owner review.'
            end,
            'fixRequired', case
              when profile_sources.failure_reason ilike '%PROVIDER%' then true
              when profile_sources.failure_reason ilike '%UNSUPPORTED%' then false
              when profile_sources.failure_reason ilike '%BLOCKED%' then false
              else true
            end,
            'status', 'open'
          ) as error_payload
        from public.profile_sources
        left join auth.users users
          on users.id = profile_sources.user_id
        where profile_sources.updated_at >= v_period_start
          and profile_sources.extraction_status = 'failed'
        union all
        select
          job_ingestions.updated_at as created_at,
          jsonb_build_object(
            'id', job_ingestions.id,
            'source', 'job_ingestion',
            'createdAt', job_ingestions.updated_at,
            'userEmail', users.email,
            'area', 'job_ingestion',
            'severity', 'high',
            'summary', coalesce(job_ingestions.title, job_ingestions.job_url),
            'code', coalesce(job_ingestions.failure_reason, 'JOB_INGESTION_FAILED'),
            'rootCause', case
              when job_ingestions.failure_reason ilike '%BLOCKED%' then 'third_party_blocked'
              when job_ingestions.failure_reason ilike '%UNSUPPORTED%' then 'unsupported_site'
              when job_ingestions.failure_reason ilike '%TOO_SHORT%' or job_ingestions.failure_reason ilike '%EMPTY%' then 'source_quality'
              else 'needs_triage'
            end,
            'rationale', case
              when job_ingestions.failure_reason ilike '%BLOCKED%' then 'The job site likely blocked public extraction or required browser/session access.'
              when job_ingestions.failure_reason ilike '%UNSUPPORTED%' then 'The job source needs a provider adapter or clearer fallback guidance.'
              when job_ingestions.failure_reason ilike '%TOO_SHORT%' or job_ingestions.failure_reason ilike '%EMPTY%' then 'The page opened but did not expose enough job description text.'
              else 'The failure is not yet classified and needs an owner review.'
            end,
            'fixRequired', true,
            'status', 'open'
          ) as error_payload
        from public.job_ingestions
        left join auth.users users
          on users.id = job_ingestions.user_id
        where job_ingestions.updated_at >= v_period_start
          and job_ingestions.ingestion_status = 'failed'
        order by created_at desc
        limit 80
      ) error_rows
    ), '[]'::jsonb),
    'supportTickets', coalesce((
      select jsonb_agg(row_payload order by updated_at desc)
      from (
        select
          support_tickets.updated_at,
          jsonb_build_object(
            'id', support_tickets.id,
            'createdAt', support_tickets.created_at,
            'updatedAt', support_tickets.updated_at,
            'userEmail', users.email,
            'status', support_tickets.status,
            'priority', support_tickets.priority,
            'sentiment', support_tickets.sentiment,
            'subject', support_tickets.subject,
            'summary', support_tickets.summary,
            'l1Disposition', support_tickets.l1_disposition,
            'escalatedToL2', support_tickets.escalated_to_l2,
            'escalationReason', support_tickets.escalation_reason
          ) as row_payload
        from public.support_tickets
        left join auth.users users
          on users.id = support_tickets.user_id
        where support_tickets.created_at >= v_period_start
        order by support_tickets.updated_at desc
        limit 80
      ) support_rows
    ), '[]'::jsonb),
    'generatedAt', now()
  )
  into v_metrics;

  return v_metrics;
end;
$$;

revoke all on function public.get_admin_operating_metrics(integer) from public;
grant execute on function public.get_admin_operating_metrics(integer) to authenticated;
