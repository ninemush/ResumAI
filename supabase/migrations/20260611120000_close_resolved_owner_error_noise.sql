update public.error_events
set
  fix_required = false,
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'ownerQueueBackfill',
    jsonb_build_object(
      'reason', 'resolved_or_guidance_signal',
      'reviewedAt', now(),
      'version', 'owner_error_queue_cleanup_v1'
    )
  ),
  resolved_at = coalesce(resolved_at, now())
where fix_required is true
  and (
    resolved_at is not null
    or exists (
      select 1
      from public.support_tickets
      where support_tickets.linked_error_event_id = error_events.id
        and support_tickets.status in ('resolved', 'closed')
        and support_tickets.fix_status = 'fixed'
    )
    or (
      root_cause_category in (
        'input_limit',
        'source_quality',
        'third_party_blocked',
        'unsupported_input',
        'unsupported_site'
      )
      and coalesce(error_code, '') <> 'USER_REPORTED_ISSUE'
    )
    or error_code in (
      'JOB_POSTING_UNAVAILABLE',
      'JOB_UNSUPPORTED_CONTENT_TYPE'
    )
  );
