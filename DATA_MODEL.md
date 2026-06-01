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
- `credit_ledger`: append-only credit grants and consumption events.
- `promo_codes`: owner-created one-time or campaign credit grants.
- `promo_code_redemptions`: redemption audit records.
- `revenuecat_events`: idempotent purchase webhook records tied to credit grants.
- `audit_events`: append-only security/product audit records.
- `application_status_events`: append-only application status history.
- Planned support tables: `support_docs`, `support_tickets`, `support_messages`, `support_actions`, and `support_escalations`.

## Deletion And Retention

Users may delete or replace editable profile data, source files, generated master resumes, and non-submitted drafts.

Profile photos are optional personal data. They must be stored in private
user-scoped storage and referenced from `profiles.photo_storage_path`.
ATS-first resume formats must not include profile photos by default.

Applications that consumed quota must retain audit-safe usage evidence. Deletion requests should minimize retained data while preserving the minimum quota/accounting/audit record required by the contract.

## Credits And Pricing

V1 uses credits instead of token-based user billing. Tokens are an internal cost
input; user pricing should map to clear value moments: profile extraction, job
analysis, resume generation, application material generation, and validated
exports.

Initial credit model:

- New account grant: 10 credits.
- Profile source extraction: 1 credit.
- Job link ingestion and fit snapshot: 1 credit.
- Master resume generation: 2 credits.
- Master resume export: 1 credit.
- Job-specific resume and cover letter generation: 4 credits.
- Job-specific PDF/DOCX export: 1 credit.

Purchase packs are intentionally simple:

- Focus Pack: 25 credits for USD 12.
- Momentum Pack: 75 credits for USD 29, positioned as the better value.

Credits are enforced server-side through `credit_ledger` and stored as an
append-only audit trail. Promo codes and RevenueCat purchases add positive
ledger entries; feature use adds negative ledger entries. When credits are
exhausted, high-cost operations are blocked until the user redeems a promo code
or purchases credits.

## Tier Seeds

Initial tiers are seeded as configuration data:

- `starter`: 5 applications per period.
- `growth`: 25 applications per period.
- `pro`: 75 applications per period.

These are launch placeholders and must be approved before public release.

## Owner Setup

The migration creates the owner/admin model but does not insert an owner automatically.

After the first user signs up, follow `OWNER_SETUP.md` to insert the owner row.

## Operating Console Metrics

Admin metrics should be produced by database functions or centralized service modules, not ad hoc component queries.

Initial aggregate sources:

- `auth.users`: signed-up and recently active users.
- `profiles`: profiles created and readiness proxy.
- `profile_sources`: source count and source-type usage.
- `job_ingestions`: job-link ingestion volume and success/failure rate.
- `applications`: logged applications, status distribution, and conversion proxy.
- `generated_resumes` and `generated_cover_letters`: generated material volume.
- `quota_events`: quota-consuming feature usage.
- `application_status_events`: outcome history.
- Support tables once introduced: ticket volume, aging, L1 resolution, and L2 escalation.
