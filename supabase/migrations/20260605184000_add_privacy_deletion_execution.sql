alter table public.privacy_requests
add column if not exists deletion_execution jsonb;
