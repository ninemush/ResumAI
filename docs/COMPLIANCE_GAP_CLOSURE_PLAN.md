# Compliance Gap Closure Plan

This plan tracks practical compliance readiness work for the product currently branded through `lib/brand.ts`. It does not claim legal compliance, certification, SOC readiness, ISO readiness, or audit completion.

## Implemented Engineering Controls

- Privacy Center in Settings for access, export, deletion, correction, restriction, objection, and AI-assisted processing review requests.
- `privacy_requests` table with RLS for user-owned reads/inserts and admin review.
- Private `privacy-exports` storage bucket for generated structured JSON exports.
- Data export service that assembles profile, source metadata, role recommendations, job ingestions, applications, generated materials, credit history, terms/privacy metadata, and privacy request history.
- Deletion/minimization plan service for admin review before destructive action.
- `security_incidents` table with admin-only RLS and notification deadline tracking when review may be required.
- Owner Console Compliance tab for privacy request aging, data inventory, subprocessors, retention status, incident summary, and hardening checklist.
- Public draft pages for privacy, data retention, AI use, subprocessors, and security overview.
- SSRF-hardened direct URL ingestion for user-provided job, profile, portfolio, and public page links, including protocol/credential blocking, local/private/reserved address blocking, DNS resolution checks, and redirect revalidation before content is fetched.
- Durable Supabase-backed API rate limiting for route handlers, with hashed bucket keys, atomic window updates, RLS-protected storage, and local in-memory buckets retained until the hosted migration is applied and `RATE_LIMIT_BACKEND=supabase` is enabled.

## Remaining Non-Code Tasks

- Legal review of Terms, Privacy Policy, Data Retention Policy, AI Use Notice, Subprocessor List, and Security Overview.
- Final retention schedule by data category, including exact periods and approved exceptions.
- DPA review for Supabase, Vercel, OpenAI, RevenueCat, and any future provider.
- Hosting region confirmation for Supabase, Vercel, OpenAI processing, and RevenueCat entitlement data.
- Cross-border transfer basis documentation for each processing location and provider.
- Breach response owner, escalation rota, and communication approval workflow.
- External security review before public launch.
- Hosted Supabase migration application and `RATE_LIMIT_BACKEND=supabase` enablement for production durable rate limiting.
- Admin access review cadence, including owner/admin role inventory and removal workflow.
- Privacy request operating procedure, including identity verification escalation and response templates.
- Incident tabletop exercise for unauthorized access, provider breach, and accidental disclosure scenarios.

## Rollback And Forward-Fix Notes

The new migrations are additive. If an issue appears, disable the Privacy Center UI entry points and admin Compliance tab while preserving the tables for audit evidence. Forward-fix RLS or route validation bugs before re-enabling request submission.
