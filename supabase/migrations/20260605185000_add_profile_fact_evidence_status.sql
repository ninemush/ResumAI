alter table public.profile_facts
add column if not exists evidence_status text not null default 'inferred'
check (evidence_status in (
  'user_confirmed',
  'source_supported',
  'inferred',
  'conflict',
  'missing_evidence'
));

update public.profile_facts
set evidence_status = case
  when user_confirmed is true or origin = 'confirmed' then 'user_confirmed'
  when origin = 'imported' and coalesce(array_length(source_ids, 1), 0) > 0 then 'source_supported'
  when origin = 'user_provided' then 'user_confirmed'
  when confidence is null or confidence < 0.55 then 'missing_evidence'
  else 'inferred'
end
where evidence_status = 'inferred';
