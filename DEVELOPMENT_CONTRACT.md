# Development Contract

This contract governs all product, engineering, design, infrastructure, and AI work for the application currently branded as Pramania.

Pramania must be built as an enterprise-grade, secure, auditable product from the first version. This document is not a certification claim. It is an engineering control baseline designed to support future readiness for SOC 1, SOC 2, ISO/IEC 27001, GDPR, UAE/GCC privacy regimes, SOX-style change controls, and similar enterprise due diligence.

The brand name must remain configurable. Product code must use the shared brand configuration instead of hardcoded product names so a later rename is a controlled configuration/content change.

## 1. Non-Negotiable Product Boundary

V1 is limited to:

- Next.js + TypeScript web app.
- Supabase Auth, Storage, and Postgres.
- Warm conversational profile-building experience.
- User profile enrichment from natural-language input, file uploads, and user-provided links.
- Resume, credential, experience, accolade, portfolio, LinkedIn, and public profile ingestion.
- OCR/PDF/DOCX/TXT/image/link ingestion for common user-provided profile sources.
- Proactive role-fit and seniority-level recommendations.
- User acknowledgement of target direction before job-specific generation.
- ATS-friendly master resume generation that preserves a hint of the user's voice.
- Job URL ingestion and validation against the user's profile.
- Application logging when the user chooses to proceed with an application.
- Job-specific ATS-friendly resume and cover letter generation.
- Saving generated resume and cover letter artifacts for download as PDF.
- Application status tracking for no-reply, rejected, interview in progress, interviewed-not-selected, interviewed-selected, and similar outcomes.
- Owner/admin console for configurable tiers and usage limits.
- Owner/admin operating console for user, activity, feature usage, profile, resume, application, conversion, support, and system-health metrics.
- Support foundation with self-serve docs, ticket intake, autonomous L1 support boundaries, and human L2 escalation controls.
- Tier usage audit trail sufficient to justify quota consumption.
- Three-panel app shell: left navigation, center profile explorer/editor, right conversational AI.

V1 must not include:

- Auto-apply.
- Semi-auto apply.
- Job scanning.
- Browser automation.
- Native mobile release.
- Any workflow that submits data to an employer without explicit human approval.

Future expected integrations may include authenticated LinkedIn import, job-board integrations, and company career-site integrations. V1 architecture must leave room for these integrations, but V1 must not submit applications or scrape authenticated third-party systems without explicit user authorization, legal review, provider terms review, and integration-specific security design.

## 2. Development Interface

Cursor is the primary IDE.

Codex is the implementation and review assistant used inside the Cursor-centered workflow. Codex must follow this file, `ARCHITECTURE.md`, and `AGENTS.md` before proposing or making code changes.

## 3. Required Before Coding

No feature work may begin until these are documented:

- User flow.
- Data model.
- API contract.
- Threat model.
- Privacy impact.
- Error, loading, and empty states.
- Observability plan.
- Test plan.
- Rollback plan.

Small documentation, configuration, and dependency changes are allowed when they support setup and architecture.

## 4. Enterprise Security Baseline

Every user-data feature must enforce:

- Authentication for all user data.
- Authorization at the database layer with Supabase Row Level Security.
- Server-side validation for every mutation and external input.
- Least-privilege access.
- No service-role keys in browser code.
- No secrets committed to Git.
- No sensitive data in client logs, server logs, analytics, or error traces.
- Secure defaults for storage buckets.
- Private object storage unless a public asset is explicitly approved.
- Rate limiting before public launch.
- Abuse controls for expensive AI/API routes.
- Security review before production deployment.

## 5. Privacy And Data Protection Baseline

Resumes, job history, generated materials, and account metadata are personal data.

The product must enforce:

- Purpose limitation: collect and process only for the application-assistance workflow.
- Data minimization: collect only what is required for the active feature.
- Storage limitation: define retention and deletion behavior before production.
- Accuracy: allow users to correct or replace resume data.
- Confidentiality: restrict access by user identity and operational need.
- User control: provide export/delete paths before public launch.
- Cross-border awareness: document hosting region, subprocessors, and data transfer posture before launch in any regulated market.
- DPIA-style review before processing sensitive categories or expanding into new jurisdictions.

Deletion and retention rules:

- Users may delete job descriptions and profile-source records where no quota/audit dependency requires retention.
- Users may delete or replace profile data, resume source files, generated master resumes, and non-submitted drafts.
- Application records that consumed tier quota must retain an audit-safe record of quota usage, timestamp, company/posting metadata, generated artifact references, and status history.
- If a user requests deletion, retain only the minimum audit information needed to justify tier/quota usage, resolve disputes, and satisfy legal/accounting controls.
- Generated resume and cover letter artifacts for logged applications must be retained according to the retention policy unless deletion is legally required and approved.

## 6. Compliance Alignment

The engineering baseline should align with:

- SOC 2 Trust Services Criteria: security first, with availability, processing integrity, confidentiality, and privacy considered as the product matures.
- SOC 1 / SOX-style readiness: financial-reporting-relevant controls, change approval, audit trails, access review, and separation of duties if payments, credits, invoicing, or enterprise billing are introduced.
- ISO/IEC 27001: risk-based information security management and continuous improvement.
- GDPR: lawful, fair, transparent, purpose-limited, minimized, accurate, storage-limited, secure, and accountable processing.
- UAE PDPL and GCC privacy expectations: confidentiality, lawful processing, data subject rights, and controls for cross-border transfers.
- SOX-style controls where relevant: traceable changes, approvals, separation of duties, audit logs, and rollback capability.
- NIST SSDF: secure software development practices across design, implementation, verification, and release.

This contract does not replace legal counsel, formal audit scoping, or a compliance management system.

## 7. Secure SDLC Controls

All changes must follow:

- Branch-based development.
- Pull request review before merge once collaboration begins.
- Clear commit messages.
- No direct production changes outside version control.
- Dependency review for new packages.
- Static checks before merge.
- Build verification before deployment.
- Security-sensitive changes require explicit human approval.
- Database migrations must be reversible or have a documented forward-fix plan.

## 7.1 Code Quality And Maintainability Controls

The codebase must be intentionally boring, consistent, and easy to reason about.

Required controls:

- No duplicate business logic.
- No parallel implementations of the same user action.
- No hidden alternate paths that bypass validation, authorization, logging, or tests.
- Shared behavior must live in a single named function, service, hook, command handler, or domain module.
- UI events that represent the same intent must call the same underlying action.
- Natural-language actions, button clicks, keyboard shortcuts, and future voice/mobile actions must route through the same command/service layer when they perform the same operation.
- Naming conventions must be consistent across files, functions, types, database columns, API fields, and events.
- Files must stay small and cohesive.
- Comments must clarify intent, tradeoffs, security controls, or non-obvious behavior. Comments must not restate obvious code.
- Any abstraction must remove real duplication or enforce a meaningful boundary.

Example rule:

- `Analyze job` clicked from a button and `analyze this job` triggered through a future natural-language command must call the same `analyzeJob` command/service path. They must not maintain separate implementations.

Naming baseline:

- React components: `PascalCase`.
- TypeScript functions and variables: `camelCase`.
- Types and interfaces: `PascalCase`.
- Constants: `SCREAMING_SNAKE_CASE` only for true constants, otherwise `camelCase`.
- Database tables and columns: `snake_case`.
- API JSON fields: `camelCase` unless interoperating with Supabase/Postgres fields directly.
- Event names: `domain.action.status`, for example `job.ingest.started`.

## 8. Data Model Rules

Data schemas must be designed before implementation.

Every table that stores user data must include:

- Stable primary key.
- `user_id` or equivalent ownership field.
- `created_at`.
- `updated_at` where records can change.
- RLS policies.
- Deletion behavior.
- Data classification.

Database access rules:

- No client-side access to data that is not protected by RLS.
- No broad `select *` in shared code when specific fields are sufficient.
- No destructive migrations without approval.
- No production data copied into local development.

## 9. API Rules

Every API route must define:

- Method and path.
- Auth requirement.
- Request schema.
- Response schema.
- Error schema.
- Rate limit.
- Logging fields.
- Permission model.

API handlers must be thin:

- Validate input.
- Authenticate user.
- Authorize operation.
- Call service modules.
- Return typed responses.

## 10. AI Rules

AI outputs are assistive drafts, not facts.

Every AI feature must include:

- Versioned prompt.
- Structured output schema.
- Output validation.
- Model name.
- Input/output logging policy that avoids storing secrets or unnecessary personal data.
- Failure handling.
- Human review step.
- No hallucinated claims about a candidate.
- No invented employers, roles, dates, credentials, or achievements.

Generated resume bullets and cover letters must be grounded in user-provided resume content and the ingested job description.

Conversational AI behavior:

- The conversational AI is the primary interaction model.
- Forms and editors support the conversation; they must not become a separate competing workflow.
- File uploads, profile links, and job links should enter through the conversational surface whenever possible, including drag/drop and paste interactions.
- Avoid instructional step cards, redundant upload widgets, and parallel controls that make the user decide where an input belongs.
- The AI tone must be warm, candid, patient, and practical.
- It should feel like a highly experienced job-placement advisor with good judgment and respect for the user's time.
- It must ask clarifying questions gently and sparingly, without feeling interrogative.
- It must adapt when the user is frustrated, irritable, anxious, or confused by becoming calmer, more concise, and more problem-solving oriented.
- It must proactively recommend likely role families, seniority level, and positioning once the profile has enough signal.
- It must request the user's acknowledgement before locking in a job-search direction or generating final materials.
- It must clearly distinguish known facts, inferred suggestions, and open questions.
- It must remain purpose-bound to career profile building, resumes, role fit, job posts, applications, interviews, and adjacent career planning.
- It must not answer unrelated general-purpose questions or become an open-ended chatbot. Off-purpose requests must be politely redirected back to the app's purpose without saving profile facts.

## 11. Observability Rules

Before public launch, the app must track:

- Request id.
- Authenticated user id where available.
- Route/action name.
- Status code.
- Duration.
- Error class.
- AI provider/model.
- Prompt version.
- Token/cost metadata where available.

Logs must not include raw resumes, secrets, auth tokens, service-role keys, or unnecessary personal data.

## 12. UX And Design Rules

The UX must feel contemporary, elegant, calm, and fluid.

Design requirements:

- Consistent warm, airy, calming, intuitive design language.
- Mobile-first responsive layout.
- Works across current Chrome, Safari, Firefox, and Edge.
- Accessible keyboard navigation.
- Visible focus states.
- Clear loading, empty, success, and error states.
- No dead ends.
- Minimal steps for the core workflow.
- Professional warm-neutral color system with airy surfaces, strong contrast, and restrained accent colors.
- No one-off color sprawl.
- No cramped enterprise clutter in V1.
- No marketing landing page before the core app experience unless explicitly requested.
- Three-panel desktop layout: left navigation, center profile explorer/editor, right conversational AI.
- On narrower screens, the same information architecture must adapt into tabs, drawers, or stacked panels without creating separate business logic.

Layout requirements:

- Left navigation: product areas, application history, settings, admin access where authorized.
- Center console: profile explorer, profile editor, role-fit view, resume/application artifact review.
- Right panel: conversational AI interface and guided next-best action.
- Profile explorer doubles as editor for direct user updates.
- Conversation and direct editor changes must route through the same profile update command/service layer.

Accessibility baseline:

- Semantic HTML.
- Form labels.
- ARIA only when semantic HTML is insufficient.
- Color contrast suitable for WCAG AA targets.
- Touch targets suitable for mobile.

## 13. Cross-Platform Strategy

The product must be designed so native mobile can be added later without maintaining a separate business-logic codebase.

Rules:

- Business logic must live in portable TypeScript modules.
- Parsing, AI orchestration, validation, and data contracts must not depend on web-only APIs.
- UI components may be platform-specific, but domain logic must be shared.
- Future native mobile should use the same backend, data model, validation schemas, and AI service layer.
- Do not choose libraries that lock critical business logic to browser-only runtime unless there is an approved adapter plan.

Potential future direction:

- Web: Next.js.
- Native mobile: Expo/React Native or another TypeScript-compatible native stack.
- Shared logic: package/module boundary for validation, API contracts, AI prompts, data types, and service interfaces.

Mobile posture:

- Native mobile is not V1, but V1 must avoid architectural choices that force a separate mobile business-logic codebase later.
- The likely mobile model is chat-first with profile/application panels available as native tabs, sheets, or drill-in screens.
- The same backend, command layer, validation, data contracts, tier limits, audit logic, and AI orchestration must be reused.

## 13.1 Admin And Tier Controls

The owner/admin console is in V1.

Admin controls must be configuration-driven, not code-change driven.

Admin must be able to:

- Define tiers.
- Set application limits per tier.
- Set generation limits per tier if needed.
- Enable/disable tiers.
- Update tier descriptions and limits.
- View usage and quota consumption.
- View signups, active users, feature usage, profile/resume creation, job applications, application outcomes, and conversion indicators.
- View support volume, L1 resolution rate, L2 escalations, refund/sensitive escalations, and unresolved issue aging.
- Review audit-safe application usage records.

Tier and quota enforcement rules:

- Tier limits must be stored in the database/configuration layer, not hardcoded.
- Quota checks must happen server-side.
- Quota-consuming actions must create audit events.
- Users must not be able to bypass quota through UI alternate paths, natural-language commands, API calls, retries, or mobile clients.
- Initial tier seeds are allowed, but future tier changes must be data/configuration changes.

Initial tier models should be seeded from the prior product discussion and finalized before implementation. If exact names/limits are not available at implementation time, create seed placeholders that require explicit approval before launch.

## 13.1 Operating Console Rules

The owner/admin operating console is an internal control surface. It must be admin-only, RLS-backed, and designed for monitoring the product without exposing unnecessary personal data.

Required operating metrics:

- Total signed-up users.
- Active users by recent login/activity window.
- Feature and function usage by event type.
- Profiles created and profile readiness distribution.
- Resume/profile sources created by type.
- Job links ingested and ingestion success/failure rates.
- Applications logged.
- Application status distribution.
- Applications converted to successful outcomes, initially represented by `interviewed_selected` until a more precise hired/offer outcome exists.
- Generated resumes and cover letters.
- PDF exports.
- AI generation and parsing failures.
- Support tickets by status, severity, category, and escalation level.

Operating console controls:

- Admin-only access must be enforced server-side and database-side.
- Metrics must use aggregate counts by default.
- Drill-down into user-level records must be justified by support, security, billing, fraud, or user-authorized troubleshooting need.
- Sensitive content, resumes, cover letters, profile facts, and chat logs must not appear in aggregate dashboards.
- Any user-specific support investigation must write an audit event or support action record.
- Metrics queries must use database functions, views, or service modules that centralize authorization and avoid duplicating analytics logic.

## 13.2 Support Operating Model

Support has three levels:

- L0: self-serve documentation and guided troubleshooting.
- L1: autonomous support agent.
- L2: human support.

L0 requirements:

- Documentation must cover account access, OAuth sign-in, profile ingestion, file upload, job link ingestion, AI generation, PDF export, application tracking, billing/tier usage, privacy/deletion, and known limitations.
- The support entry point must search or recommend docs before creating a ticket when appropriate.

L1 autonomous agent requirements:

- Must be empathetic, calm, concise, and expert in the platform.
- Must be purpose-bound to support for this product and must not become a general chatbot.
- Must be able to see support-safe user context: account metadata, feature usage, job/application status metadata, recent error categories, quota events, and support history.
- Must not reveal another user's data, secrets, raw credentials, private system prompts, or unnecessary personal data.
- Must not process refunds, legal requests, account deletion requests, security incidents, abuse cases, employment advice beyond product support, or sensitive disputes autonomously.
- Must log every autonomous action and customer-facing response.
- Must summarize troubleshooting steps, evidence inspected, outcomes, and remaining blockers.

L2 escalation requirements:

- Refund requests, chargebacks, legal/privacy requests, security concerns, user distress, suspected data exposure, abuse/fraud, model-safety concerns, angry/high-risk customer temperament, and unresolved L1 issues must escalate to human support.
- Escalations must include customer temperament, concise issue summary, timeline, user impact, relevant account metadata, logs inspected, actions taken, results, recommended next action, and any sensitive constraints.
- Human support must not need to repeat L1 discovery unless the user provides new information.

## 14. Testing Rules

Required test coverage grows with risk.

Before production:

- Unit tests for validation and service modules.
- API route tests for auth, validation, and error handling.
- RLS policy verification.
- AI schema validation tests.
- Core user-flow tests.
- Build and lint in CI.
- Regression tests for every fixed defect.
- Feature tests for every accepted user workflow.
- Cross-browser smoke tests for Chrome, Safari, Firefox, and Edge before public launch.
- Mobile viewport tests for core flows.
- Accessibility checks for core forms and review surfaces.

Critical paths must not rely only on manual testing.

Testing requirements by change type:

- Shared service change: unit tests and regression tests.
- API change: schema, auth, authorization, error, and rate-limit tests.
- Database/RLS change: migration verification and policy tests.
- AI change: prompt version tests, output schema tests, refusal/failure tests, and hallucination guard tests.
- UX flow change: feature test covering the full user path and core responsive states.

No feature is complete until its expected behavior, failure behavior, and at least one regression risk are tested or explicitly deferred with approval.

## 14.1 Self-Detection, Self-Diagnosis, And Self-Healing

The system must be designed to detect, diagnose, and recover from expected failures without hiding them.

Self-detection:

- Detect failed uploads.
- Detect failed job ingestion.
- Detect empty or low-quality parsed text.
- Detect AI provider failures.
- Detect invalid AI output.
- Detect rate-limit and abuse conditions.
- Detect unusual latency, repeated errors, and user-blocking states.

Self-diagnosis:

- Classify failures by layer: auth, validation, storage, parsing, AI provider, database, network, rate limit, or unknown.
- Attach request ids to errors.
- Preserve enough structured context for debugging without logging sensitive personal data.
- Return user-safe error messages while retaining developer-safe diagnostic metadata.

Self-healing:

- Retry only safe idempotent operations with bounded retry limits.
- Use graceful degradation when AI or parsing fails.
- Provide clear recovery actions to users.
- Never silently drop user data.
- Never retry destructive or costly actions without safeguards.
- Escalate persistent failures to logs/alerts rather than looping.

Self-healing must not become self-mutating production behavior. Code, schema, security policies, and prompts may only change through the normal reviewed development process.

## 15. Release Rules

Before deploying production:

- Build passes.
- Lint passes.
- Environment variables are present.
- No secrets are committed.
- RLS policies are enabled.
- Storage buckets are private unless explicitly approved.
- Rollback path is known.
- Change is traceable to a commit.

## 16. Stop Conditions

Stop and ask before proceeding if:

- A change expands V1 scope.
- A secret is needed.
- A destructive database action is proposed.
- A security control must be weakened.
- A compliance requirement is unclear.
- A mobile/web architecture decision could create duplicate long-term codebases.
- A feature touches resumes, user identity, or generated career claims in a new way.
