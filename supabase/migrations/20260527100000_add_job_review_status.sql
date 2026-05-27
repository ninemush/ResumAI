alter table public.job_ingestions
add column if not exists review_status text not null default 'needs_review'
check (review_status in ('needs_review', 'accepted', 'rejected'));

create index if not exists job_ingestions_review_status_idx
on public.job_ingestions(user_id, review_status);
