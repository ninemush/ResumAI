# Implementation Plan

This plan converts the approved V1 scope into controlled implementation phases. Each phase must preserve the `DEVELOPMENT_CONTRACT.md` controls.

## Phase 0: Governance And Infra

Status: complete locally.

Deliverables:

- Development contract.
- Product scope.
- Architecture.
- Cursor/Codex agent rules.
- Supabase project linked.
- Vercel project linked.
- Environment variable templates.

Exit criteria:

- Local build passes.
- Supabase and Vercel are linked.
- Governance docs are committed.

## Phase 1: Secure Data Foundation

Goal: create the database, RLS, storage, tier, quota, and audit foundation before product behavior.

Deliverables:

- Supabase migration for V1 data model.
- RLS policies for user-owned data.
- Owner/admin role model.
- Config-driven tier tables.
- Quota event model.
- Application audit retention model.
- Private storage buckets for profile sources and generated artifacts.

Exit criteria:

- Migration applies cleanly.
- RLS is enabled on every user/admin table.
- Users can only access own data.
- Admin-only tables are not user-writable.
- Tier limits are stored as data, not code.

## Phase 2: Command And Validation Layer

Goal: prevent duplicated logic and alternate action paths.

Deliverables:

- `lib/commands` command interface.
- Shared command result and typed error taxonomy.
- Shared validation schemas.
- Auth/authorization helpers.
- Quota check and consume commands.

Exit criteria:

- UI, API, and future natural-language commands call the same command/service entry points.
- No product mutation bypasses validation, authorization, quota checks, or audit logging.

## Phase 3: Design System And App Shell

Goal: establish the warm, airy, calm, three-panel interface.

Deliverables:

- Design tokens for color, spacing, type, radius, and states.
- Left navigation shell.
- Center profile explorer/editor area.
- Right conversational AI panel.
- Responsive mobile adaptation pattern.

Exit criteria:

- Layout works on desktop and mobile viewports.
- Color contrast is suitable for core text and controls.
- Browser smoke check passes for core shell.

## Phase 4: Auth And Access Control

Goal: secure the app behind Supabase Auth and role checks.

Deliverables:

- Supabase browser/server clients.
- Protected app routes.
- Sign in/sign up flow.
- Owner/admin detection.
- Session state handling.

Exit criteria:

- Unauthenticated users cannot access app data.
- Authenticated users only see their own records.
- Admin routes require owner/admin role.

## Phase 5: Profile Build

Goal: build the conversation-first profile system.

Status: in progress. Natural-language intake exists. Profile source metadata
ingestion now supports user-scoped uploads and user-provided profile links. TXT
and PDF file extraction now feed the shared profile fact pipeline. DOCX parsing,
OCR, public link extraction, and authenticated LinkedIn import remain follow-up
work.

Deliverables:

- Natural-language profile input.
- Direct profile explorer/editor updates.
- File upload for PDF/DOCX/TXT/image.
- Link ingestion records.
- OCR/parsing provider adapter boundary.
- Profile fact extraction and confirmation.
- Role-fit and seniority recommendations.

Exit criteria:

- Conversation and editor changes use the same profile commands.
- Inferred facts are distinguishable from confirmed facts.
- User can correct or delete editable profile records.

## Phase 6: Resume Generation

Goal: generate ATS-friendly master resumes grounded in confirmed profile facts.

Deliverables:

- Versioned prompts.
- Structured AI output schemas.
- Master resume generation command.
- PDF artifact generation.
- Generated artifact storage.

Exit criteria:

- AI output validates against schema.
- Generated resume does not invent facts.
- Artifact is stored in a private user-scoped path.

## Phase 7: Job And Application Flow

Goal: validate job fit and create application-specific materials.

Deliverables:

- Job URL ingestion.
- SSRF-safe fetch strategy.
- Job parsing.
- Match analysis.
- Application logging.
- Quota consumption.
- Job-specific resume and cover letter generation.
- Application status updates.

Exit criteria:

- Logged applications create quota events.
- Generated materials are retained with the application.
- Application records cannot be erased in a way that destroys quota audit evidence.

## Phase 8: Admin Console

Goal: owner/admin can manage tiers and view usage without code changes.

Deliverables:

- Admin tier list/edit UI.
- Tier create/update/disable commands.
- Usage and quota views.
- Admin audit events.

Exit criteria:

- Tier configuration is data-driven.
- Quota limits update without code changes.
- Admin actions are audited.

## Phase 9: Testing, Observability, And Hardening

Goal: make the V1 resilient enough for private beta.

Deliverables:

- Unit tests.
- API tests.
- RLS/policy verification.
- Regression tests.
- Core feature tests.
- Browser/mobile viewport checks.
- Error taxonomy and structured logging.
- Safe retry/fallback patterns.

Exit criteria:

- Build and lint pass.
- Critical flows have test coverage.
- Logs avoid sensitive personal data.
- Known failure modes have user-safe recovery states.

## Open Decisions

- Final tier names and limits.
- OCR provider.
- PDF generation approach.
- Error tracking provider.
- Analytics/event tracking provider.
- Mobile navigation model.
- Retention durations for audit-safe application records and generated artifacts.
