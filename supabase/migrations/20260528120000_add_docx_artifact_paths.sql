alter table public.generated_resumes
add column if not exists docx_storage_path text;

alter table public.generated_cover_letters
add column if not exists docx_storage_path text;
