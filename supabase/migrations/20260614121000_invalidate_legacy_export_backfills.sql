update public.generated_resumes
set
  export_status = 'not_exported',
  export_validated_at = null,
  export_failed_reason = 'LEGACY_EXPORT_REVALIDATION_REQUIRED',
  export_validation = export_validation || jsonb_build_object(
    'legacyReusableBlockedAt',
    now(),
    'legacyReusableBlockedBy',
    '20260614121000_invalidate_legacy_export_backfills',
    'requiresModernRevalidation',
    true
  )
where export_status = 'export_validated'
  and export_validation ->> 'legacyBackfill' = 'true';

update public.generated_cover_letters
set
  export_status = 'not_exported',
  export_validated_at = null,
  export_failed_reason = 'LEGACY_EXPORT_REVALIDATION_REQUIRED',
  export_validation = export_validation || jsonb_build_object(
    'legacyReusableBlockedAt',
    now(),
    'legacyReusableBlockedBy',
    '20260614121000_invalidate_legacy_export_backfills',
    'requiresModernRevalidation',
    true
  )
where export_status = 'export_validated'
  and export_validation ->> 'legacyBackfill' = 'true';

/*
  Rollback:
  Re-marking legacy rows as export_validated is intentionally not automated.
  If production needs emergency access to a known-good artifact, revalidate it
  through the current export flow or apply a targeted, audited forward-fix row
  update after confirming claim review and artifact validation evidence.
*/
