alter table public.generated_cover_letters
add column if not exists reviewer_notes text[] not null default '{}',
add column if not exists claim_risks jsonb not null default '[]'::jsonb;

create index if not exists generated_cover_letters_claim_risks_idx
on public.generated_cover_letters(user_id, application_id)
where claim_risks <> '[]'::jsonb;
