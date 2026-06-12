alter table public.generated_resumes
add column if not exists export_status text not null default 'not_exported',
add column if not exists export_validation jsonb not null default '{}'::jsonb,
add column if not exists export_validated_at timestamptz,
add column if not exists export_failed_reason text,
add column if not exists claim_review_acknowledged_at timestamptz,
add column if not exists claim_review_acknowledged_by uuid references auth.users(id) on delete set null,
add column if not exists claim_review_acknowledgement jsonb not null default '{}'::jsonb;

alter table public.generated_cover_letters
add column if not exists export_status text not null default 'not_exported',
add column if not exists export_validation jsonb not null default '{}'::jsonb,
add column if not exists export_validated_at timestamptz,
add column if not exists export_failed_reason text,
add column if not exists claim_review_acknowledged_at timestamptz,
add column if not exists claim_review_acknowledged_by uuid references auth.users(id) on delete set null,
add column if not exists claim_review_acknowledgement jsonb not null default '{}'::jsonb;

do $$
begin
  alter table public.generated_resumes
    add constraint generated_resumes_export_status_check
    check (export_status in ('not_exported', 'export_pending', 'export_validated', 'export_failed'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.generated_cover_letters
    add constraint generated_cover_letters_export_status_check
    check (export_status in ('not_exported', 'export_pending', 'export_validated', 'export_failed'));
exception
  when duplicate_object then null;
end $$;

update public.generated_resumes
set
  export_status = 'export_validated',
  export_validated_at = coalesce(updated_at, now()),
  export_validation = export_validation || jsonb_build_object(
    'legacyBackfill',
    true,
    'validatedBy',
    '20260612143000_export_validation_and_review_acknowledgement'
  )
where
  pdf_storage_path is not null
  and docx_storage_path is not null
  and export_status = 'not_exported';

update public.generated_cover_letters
set
  export_status = 'export_validated',
  export_validated_at = coalesce(updated_at, now()),
  export_validation = export_validation || jsonb_build_object(
    'legacyBackfill',
    true,
    'validatedBy',
    '20260612143000_export_validation_and_review_acknowledgement'
  )
where
  pdf_storage_path is not null
  and docx_storage_path is not null
  and export_status = 'not_exported';

create index if not exists generated_resumes_export_status_idx
on public.generated_resumes(user_id, export_status, updated_at desc);

create index if not exists generated_cover_letters_export_status_idx
on public.generated_cover_letters(user_id, export_status, updated_at desc);
