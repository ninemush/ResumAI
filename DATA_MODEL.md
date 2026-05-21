# Data Model

This document summarizes the V1 data model implemented by the initial Supabase migration.

## Ownership Model

Most user data has a `user_id` column referencing `auth.users(id)`.

User-owned tables use RLS so authenticated users can only access records where:

```sql
auth.uid() = user_id
```

Admin-only operations use `admin_roles`.

## Core Tables

- `admin_roles`: owner/admin role assignments.
- `tiers`: configurable tier definitions.
- `user_tiers`: user-to-tier assignments.
- `profiles`: current profile and positioning.
- `profile_sources`: files, text, links, and future import sources.
- `profile_facts`: normalized profile facts from user input, parsing, and inference.
- `role_recommendations`: proactive role and level recommendations.
- `job_ingestions`: ingested job postings.
- `applications`: logged application opportunities.
- `generated_resumes`: master and job-specific resume artifacts.
- `generated_cover_letters`: job-specific cover letter artifacts.
- `quota_events`: append-only quota consumption records.
- `audit_events`: append-only security/product audit records.

## Deletion And Retention

Users may delete or replace editable profile data, source files, generated master resumes, and non-submitted drafts.

Applications that consumed quota must retain audit-safe usage evidence. Deletion requests should minimize retained data while preserving the minimum quota/accounting/audit record required by the contract.

## Tier Seeds

Initial tiers are seeded as configuration data:

- `starter`: 5 applications per period.
- `growth`: 25 applications per period.
- `pro`: 75 applications per period.

These are launch placeholders and must be approved before public release.

## Owner Setup

The migration creates the owner/admin model but does not insert an owner automatically.

After the first user signs up, follow `OWNER_SETUP.md` to insert the owner row.
