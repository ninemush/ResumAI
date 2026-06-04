create or replace function public.complete_privacy_export(
  p_request_id uuid,
  p_export_storage_path text
)
returns public.privacy_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.privacy_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_export_storage_path is null
    or split_part(p_export_storage_path, '/', 1) <> auth.uid()::text then
    raise exception 'INVALID_EXPORT_STORAGE_PATH';
  end if;

  update public.privacy_requests
  set export_storage_path = p_export_storage_path,
      resolution_summary = 'Structured JSON export generated in private user-scoped storage. Uploaded binary files are referenced by metadata only in v1.',
      status = 'completed',
      resolved_at = now()
  where id = p_request_id
    and user_id = auth.uid()
    and request_type = 'export'
  returning *
  into v_request;

  if not found then
    raise exception 'PRIVACY_EXPORT_REQUEST_NOT_FOUND';
  end if;

  return v_request;
end;
$$;

revoke all on function public.complete_privacy_export(uuid, text) from public;
grant execute on function public.complete_privacy_export(uuid, text) to authenticated;
