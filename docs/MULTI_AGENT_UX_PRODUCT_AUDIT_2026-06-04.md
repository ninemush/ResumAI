# Multi-Agent UX/Product Audit - 2026-06-04

## Scope

Read-only multi-agent review of the Pramania app across:

- Cockpit, navigation, layout, and responsive shell
- Owner console and platform operations
- Profile intake, source ingestion, and master resume
- Jobs, applications, and generated artifacts
- Conversational AI, language, memory, and advisory quality
- Settings, support, billing, trust, legal, and account recovery

No files were edited during the audit.

## Validation Run

Authenticated workspace checks passed against the local app.

- Desktop: `8 passed`, `2 mobile-only skipped`
- Mobile: `5 passed`, `5 desktop-only skipped`

The passing tests confirm that the signed-in workspace renders, record-heavy pages are compact, mobile chat-first behavior works, advisor context returns a response, owner console renders for an owner account, master resume overflow is guarded, and unsaved resume navigation warnings are covered.

## Executive Outcome

Pramania has a credible foundation and is materially stronger than earlier passes. The app now has real product surfaces for chat-first intake, source ingestion, profile building, master resume generation, jobs, applications, artifacts, settings, support, billing, and owner operations.

However, the reviewers do not consider V1 ship-ready yet. The largest gaps are not simply missing screens. The bigger issue is that core workflows still feel too indirect or brittle:

- The conversation layer still has too much deterministic routing before the LLM advisor gets a clean orchestration pass.
- Users can do important things, but the lowest-effort path is often hidden in chat rather than clearly available where the user is.
- Jobs, applications, and artifacts are records, but not yet strong end-to-end workflows.
- Trust surfaces exist, but data rights, support, billing, and owner controls are not concrete enough for launch confidence.

## Common Themes By Priority

### P0 - Conversation Quality And Orchestration

The prompt quality is strong, but the implementation still routes many messages through local command/profile branches before the LLM advisor. This can make Pramania feel like an if/then bot when the user expects a context-aware career companion.

Recommended direction:

- Move to a server-side conversation orchestrator.
- Let the model classify intent, decide whether action needs confirmation, execute or defer actions, verify state, and then respond.
- Add streaming responses.
- Add stable request/thread IDs so concurrent user messages do not race context.
- Store action metadata and chip context with conversation messages.
- Separate navigation chips from true executable action buttons.
- Add durable memory for goals, preferred roles, rejected lanes, anxieties, open questions, and last commitments.

### P0 - Minimal-Effort Intake Is Too Hidden

The app can ingest resumes, LinkedIn PDFs/archives, screenshots, documents, links, and natural-language notes, but the user may not discover the best path. Important actions are mainly embedded in the chat rail.

Recommended direction:

- Add visible first-class intake affordances on Profile & Resume.
- Provide simple options: drop resume, LinkedIn PDF/export, LinkedIn URL, portfolio/profile link, paste text.
- Keep chat as the primary path, but make every relevant page able to route the user into the correct chat action or intake command.
- Add clearer empty-state CTAs in Jobs, Profile, Resume, and Library.

### P1 - Records Need To Become Workflows

Jobs, Applications, and Artifacts now have compact rows and useful data, but they are not yet a natural job-search operating system.

Recommended direction:

- Split job pursuit into clear steps: `Review fit -> Save to pursue -> Generate packet -> Mark applied`.
- Keep “draft/pursuing” separate from “applied.”
- Add applied date, next action, follow-up date, recruiter/contact, notes, priority, interview round, compensation/location, source, and stale/no-reply markers.
- Add search, sort, saved views, compact density, bulk archive, and “needs action” views.
- Make artifacts previewable, traceable to applications, and version-aware.

### P1 - Trust And Launch Readiness

Settings, Support, Billing, Privacy, Terms, and auth recovery have real foundations, but several trust-critical actions are not yet actionable enough.

Recommended direction:

- Add Settings data-rights controls: export my data, delete account, delete uploaded sources/drafts, privacy request, and contact fallback.
- Add direct Support issue creation with category, severity, privacy/security/refund routing, attachment/context consent, expected response time, and human escalation copy.
- Remove “purchase link pending” from launch-facing billing UI.
- Add post-purchase confirmation, receipt/download status, refund/payment terms, and clearer purchase history.
- Add terms gate version/effective date, privacy acknowledgement if needed, review-changes link, and decline/sign-out path.
- Improve MFA/recovery copy with expiry, resend limits, wrong-email/no-access guidance, and support fallback.

### P1 - Owner Console Is Observability, Not Full Control

The owner console has useful metrics, error visibility, support queues, profitability, users, credits, and promo tools. It does not yet let the owner manage Pramania end to end.

Recommended direction:

- Add a user detail drawer/page with timeline, support issues, credit ledger, profile/job/application counts, tier, entitlements, admin notes, audit events, and actions.
- Add tier and entitlement management.
- Add admin-role management, account suspension, abuse holds, deletion/export request handling, and audit-event review.
- Add guardrails for credit and promo operations: confirmation, required reason, revoke/disable, redemption list, bulk preview, negative adjustments, refund references, and threshold approval.
- Fix “All time” period semantics so metrics, credits, and profitability use the same time window.

### P2 - Layout And Discoverability

The shell has a calm, mature command-center feel, but the three-pane layout can squeeze the work surface. Several important controls are discoverable only through icons or hover.

Recommended direction:

- Add explicit AI pane controls: collapse, expand, width presets, and remembered preference.
- Make resize handles subtly visible by default.
- Add a mobile “More” drawer for Library, Settings, Support, and owner/admin surfaces.
- Tighten mobile chat/card density.
- Promote empty-state next actions into the center pane.
- Keep the brand warm and airy, but tune productivity surfaces toward calm density.

## Detailed Per-Agent Feedback

## Agent 1 - Cockpit, Navigation, Layout, And Journey

Persona: senior product designer specializing in multi-pane SaaS workspaces, command centers, and conversational copilots.

### Findings

1. **High: Desktop pane balance strains the main workspace.**  
   At 1280px, the nav plus persistent AI pane leaves document-heavy views feeling narrow. Resize exists, but the handles are nearly invisible and there is no obvious collapse for the AI pane.

2. **High: Mobile navigation hides important destinations.**  
   Mobile bottom nav exposes Chat, Profile, Jobs, and Apps only. Library, Settings, Support, and Owner are absent from primary navigation, which is risky for account, billing, support, and recovery flows.

3. **Medium: Chat-first mobile is conceptually strong but spatially heavy.**  
   The fixed composer plus bottom nav consume meaningful vertical space, and chat cards feel large for repeated review.

4. **Medium: Empty workspace states underuse the center pane.**  
   Jobs and similar empty states are calm, but the actionable path often lives in the right AI panel, making the center feel passive.

5. **Low: The navigation model is visually elegant but under-signposted.**  
   Collapsed nav, resize, drag/drop, voice, and action chips exist, but several are discoverable only by icon or hover.

### What Works

- Mature, calm command-center feel.
- Warm neutrals, quiet borders, and good type contrast.
- Persistent advisor feels integrated rather than pasted on.
- Desktop navigation is clear.
- Profile cockpit communicates progress well.
- Chat supports files, paste, drag/drop, voice, suggested actions, and contextual routing.

### Recommendations

- Add AI pane collapse/expand controls, width presets, and remembered user preference.
- Make resize handles subtly visible.
- Add mobile “More” navigation for Library, Settings, Support, and owner/admin surfaces.
- Tighten mobile chat density.
- Promote next actions directly into empty center panes.

### Evidence

Inspected:

- `components/app-shell/workspace-layout.tsx`
- `components/app-shell/side-nav.tsx`
- `components/conversation/conversation-panel.tsx`
- `app/globals.css`
- `tests/e2e/authenticated-workspace.spec.ts`
- `tests/e2e/user-journey-qa.spec.ts`
- Existing QA screenshots in `qa-artifacts/user-journey-qa`

## Agent 2 - Owner Console And Platform Operations

Persona: SaaS owner/admin console expert covering operations, entitlements, quotas, compliance, support, abuse, revenue, and usage.

### Findings

1. **High: Owner control surface is incomplete for end-to-end platform management.**  
   The console observes users, support, errors, profitability, and promos, but does not manage tiers, entitlements, admin roles, account status, abuse holds, user deletion/export requests, refunds, or compliance/audit review.

2. **High: “All time” reporting is misleading and internally inconsistent.**  
   The UI sends `periodDays=0`; metrics are effectively clamped differently across product metrics, credit economics, and profitability assumptions.

3. **High: Support and error workflows are useful, but not yet a real operations queue.**  
   There is no owner assignment, SLA clock, escalation workflow, issue detail route, user timeline, linked resource navigation, or visible failure handling when updates fail.

4. **Medium: Credit and promo operations need stronger guardrails.**  
   Owners can grant credits and create promo codes without enough confirmation, business reason, revocation, redemption drilldown, refund linkage, or approval threshold.

5. **Medium: UX is broad but dense, and important journeys are not task-first.**  
   Users are not clickable, tables are mostly static, and owner actions are scattered.

### What Works

- Strong metrics foundation.
- Period filters, root-cause breakdowns, support queues, outcome segmentation, page timing, profitability, and credit evidence exist.
- Admin access is gated server-side and owner nav is hidden unless the session is owner-level.

### Recommendations

- Add a real user detail drawer/page.
- Add owner APIs/UI for tier and entitlement management.
- Add admin role management, account suspension, abuse holds, data request handling, and audit review.
- Fix time-window semantics.
- Upgrade support into a queue with assignment, SLA, priority, escalation, linked resources, and visible mutation failures.
- Add credit and promo guardrails.

### Evidence

Inspected:

- `components/admin/owner-console.tsx`
- `lib/admin/owner-metrics.ts`
- `app/api/admin/metrics/route.ts`
- `app/api/admin/issues/[id]/route.ts`
- `app/api/admin/credits/grants/route.ts`
- `app/api/admin/promo-codes/route.ts`
- `lib/billing/credits.ts`
- Admin migrations
- Owner/API E2E coverage

## Agent 3 - Profile, Intake, And Master Resume

Persona: career platform product expert and resume strategist.

### Findings

1. **High: Intake is capable, but the minimal-effort path is too hidden.**  
   Upload/drop/link intake lives mainly in the chat rail. Profile Explorer mostly exposes manual fields, so a first-time user may not realize that dropping a resume or LinkedIn export is the main path.

2. **High: Resume evidence is not traceable at the bullet/fact level.**  
   Sources are preserved and previewable, but the master resume does not expose which source supports each role, bullet, metric, or claim.

3. **Medium: Chronology quality depends heavily on heuristic parsing.**  
   LinkedIn-style extraction coverage exists, but role detection relies on regexes for titles, locations, impact verbs, and similar patterns. It may miss unconventional titles, career breaks, parallel roles, consulting projects, or older experience.

4. **Medium: Completeness/readiness is too coarse for strong master resume confidence.**  
   Generation can proceed without requiring full contact details, dates, employer chronology, education, credentials, or quantified impact.

5. **Medium: Auto-refreshing the master resume after new evidence may surprise users.**  
   Background resume refresh after saved facts is useful, but risky if users upload multiple sources or have edits they want preserved.

### What Works

- Chat-first intake.
- File/link ingestion.
- LinkedIn fallback guidance.
- Source library.
- Profile intelligence.
- Role recommendations.
- Master resume editor.
- PDF/DOCX export.
- Credit/error handling.
- Strong profile and resume prompts.

### Recommendations

- Add visible “Build my profile” intake options on Profile & Resume.
- Add source-backed fact drawers and bullet-level evidence badges.
- Split readiness into draftable, review needed, and export ready.
- Replace or supplement regex chronology parsing with a structured extraction pass that stores normalized roles, dates, employers, locations, bullets, source IDs, and unresolved questions.
- Make master resume refresh explicit or batched after ingestion.

### Evidence

Inspected:

- `components/conversation/conversation-panel.tsx`
- `components/profile/profile-explorer.tsx`
- `components/resume/master-resume-panel.tsx`
- `components/knowledgebase/knowledgebase-panel.tsx`
- `lib/profile/profile-intake.ts`
- `lib/parsing/profile-source-extraction.ts`
- `lib/resumes/master-resume.ts`
- `lib/resumes/source-experience.ts`
- Profile and resume API routes

## Agent 4 - Jobs, Applications, And Artifacts

Persona: applicant tracking and career workflow UX expert.

### Findings

1. **High: Job ingestion is hidden behind chat.**  
   The Jobs page says to paste a job post, but the page itself has no paste field or CTA. Ingestion only happens when chat detects a job URL.

2. **High: “Create packet” conflates logging, applying, generation, and export.**  
   A ready job can create an application and immediately generate/export materials. There is no explicit “I want to pursue this,” “I applied,” or “generate materials now?” confirmation step.

3. **High: Application tracking is too thin for a natural job-search pipeline.**  
   Statuses exist, but there are no applied dates, follow-up dates, recruiter/contact fields, next action, interview round, notes, priority, location, compensation, source, or reminder affordances.

4. **Medium: Scale controls are not enough for 50-100+ roles.**  
   Jobs and Applications have archive toggles and filters, but no search, sort, saved views, compact density mode, bulk archive, stale/no-reply surfacing, or needs-action queue.

5. **Medium: Artifacts are downloadable, but not reviewable enough.**  
   Library shows rows, status, version, and links, but lacks inline preview, version comparison, application traceability, regenerate history, and navigation back to the application packet.

### What Works

- Solid underlying record model.
- Jobs, applications, generated resumes, cover letters, status events, archive state, and signed downloads exist.
- Library’s generated-materials tab works.
- Application packet editor has useful foundations: resume fields, cover letter, export readiness, warnings, and reset-on-save behavior.

### Recommendations

- Add first-class “Add job” control on Jobs with URL paste, text paste fallback, and clear ingestion states.
- Split pursuit journey: `Review fit -> Save to pursue -> Generate packet -> Mark applied`.
- Upgrade Applications into a pipeline table with next action, dates, contact, notes, source, priority, and stale markers.
- Add search/sort/density across Jobs, Applications, and Library.
- Make artifacts traceable with inline preview, version history, latest labels, and links back to application/master context.

### Evidence

Inspected:

- `components/jobs/job-ingestion-panel.tsx`
- `components/applications/application-panel.tsx`
- `components/artifacts/artifacts-panel.tsx`
- `components/conversation/conversation-panel.tsx`
- `lib/jobs/job-overview.ts`
- `lib/jobs/job-fit.ts`
- `lib/applications/application-overview.ts`
- `lib/artifacts/artifact-overview.ts`
- `/api/jobs/ingest`
- `/api/applications`
- `/api/applications/[id]/materials`
- `/api/applications/[id]/materials/export`

## Agent 5 - Conversational AI, Language, And Advisory Quality

Persona: conversation designer and AI product lead for career/advisor products.

### Findings

1. **High: Conversation routing is still too deterministic.**  
   The client runs many local command/profile branches before the advisor, with regex-heavy routing. Nuanced career replies can feel misclassified instead of understood.

2. **High: No streaming, and concurrent messages can race context.**  
   Advisor calls use whole-response fetch. Input stays enabled, which is good, but a second send can be processed while the first reply/persistence is unresolved.

3. **Medium: Long-term companion memory is shallow.**  
   The advisor reads recent conversation only. There is no durable summary of preferences, emotional state, goals, anxieties, rejected lanes, or “what matters to this user.”

4. **Medium: Suggested actions may overpromise.**  
   Suggested action schema allows generate/export/review kinds, but UI chips mostly navigate. If a chip implies execution but only opens a page, trust suffers.

5. **Medium: Message formatting is helpful but fragile.**  
   Custom parsing handles headings, bullets, and bold text, but not richer markdown or links. Generated file URLs can appear as plain text.

### What Works

- Advisor prompt is strong, purpose-bound, warm, and context-aware.
- Prompt explicitly says not to ask users to repeat saved data.
- Prompt tells advisor not to pretend actions happened.
- Latency copy is thoughtful and career-specific.
- Draft retention, file drop, voice input, credit exhaustion messaging, and mobile chat-first behavior are good trust builders.

### Recommendations

- Build one server-side conversation orchestrator.
- Add streaming with stable request/thread IDs.
- Keep input enabled but show queued/in-flight messages clearly.
- Include pending user turns in context.
- Add durable memory for goals, preferences, open questions, advisor commitments, and rejected lanes.
- Make chips honest: navigation chips should say “Go to…” and executable commands should actually execute or ask for confirmation.
- Render links safely in chat.

### Evidence

Inspected:

- `app/api/conversation/advisor/route.ts`
- `app/api/conversation/messages/route.ts`
- `components/conversation/conversation-panel.tsx`
- `lib/conversation/advisor.ts`
- `lib/conversation/conversation-messages.ts`
- `lib/conversation/app-capabilities.ts`
- `lib/ai/openai.ts`
- `lib/ai/prompts/profile-intake.ts`
- `app/globals.css`
- Conversation/workspace E2E tests

## Agent 6 - Settings, Support, Billing, Trust, And Legal

Persona: SaaS trust and monetization UX expert.

### Findings

1. **High: Data rights are not actionable enough for V1.**  
   Privacy says users can request access, correction, deletion, or export through support, but Settings has no export/delete/request controls and Support has no direct privacy-request intake form.

2. **High: Billing is transparent, but purchase/receipt readiness still has launch gaps.**  
   Credits are explained well, but Settings can show “Purchase link pending,” invoices are derived from purchase rows, and receipt status is hard-coded.

3. **High: Support intake is too indirect for trust-critical situations.**  
   Support tells users to ask chat. There is no direct issue form, category selector, attachment/context consent, refund/privacy/security path, SLA, or human escalation copy.

4. **Medium: Returning-user terms gate is clean but under-specified.**  
   Sign-up acknowledges Terms and Privacy, but the returning-user gate only asks for Terms acceptance, does not show version/effective date in the card, and gives no decline/sign-out path.

5. **Medium: Auth protection is strong, but recovery UX needs more reassurance.**  
   Email-code gate has verify, resend, and sign out, but lacks code expiry guidance, wrong-email/no-access help, support fallback, and “check spam” recovery copy.

### What Works

- Credits are explained clearly: one-time packs, no auto-renewal, no surprise deductions, examples, free actions, and low-balance behavior.
- Trust foundations exist: terms version capture, email-code protection, password lockout copy, rate-limited auth/billing/legal/support routes, user-scoped support history, RevenueCat webhook fail-closed behavior, and clear AI-output responsibility language.

### Recommendations

- Add Settings Data and Privacy area with export, delete, privacy request, and contact fallback.
- Make billing launch-complete and remove pending purchase links from production UI.
- Add receipt/download status, refund/payment terms, and post-purchase confirmation.
- Upgrade Support into direct V1 intake with categories, severity, privacy/security/refund routing, expected response time, and visible navigation.
- Revise returning-user terms gate with version/effective date, privacy acknowledgement, review changes, and decline/sign-out.
- Improve MFA/recovery copy.

### Evidence

Inspected:

- `components/settings/settings-panel.tsx`
- `components/support/support-panel.tsx`
- `app/credits/page.tsx`
- `app/privacy/page.tsx`
- `app/terms/page.tsx`
- `components/auth/auth-panel.tsx`
- `components/auth/email-mfa-gate.tsx`
- Billing, support, legal API routes
- Privacy/backlog docs

## Recommended Execution Order

1. **Conversation orchestration**
   - Server-side LLM-first orchestrator
   - Streaming
   - Durable memory
   - Honest executable actions

2. **First-class intake**
   - Profile upload/link/text actions
   - Job paste action
   - LinkedIn PDF/export guidance
   - Source-to-profile visibility

3. **Application pipeline**
   - Next action
   - Dates
   - Contacts
   - Notes
   - Priority
   - Stale/no-reply surfacing

4. **Trust hardening**
   - Support form
   - Data export/delete requests
   - Billing completion
   - Terms/privacy acceptance clarity

5. **Owner controls**
   - User detail
   - Tier/entitlement management
   - Credit guardrails
   - Audit review

6. **Layout polish**
   - Collapsible AI pane
   - Mobile More menu
   - Clearer resize affordances
   - Calm dense productivity surfaces

## Bottom Line

Pramania has a strong foundation and a much clearer product shape than earlier builds. The next phase should not be scattered feature addition. It should focus on making the system feel coherent, trustworthy, and effortless:

- one intelligent conversation brain,
- visible low-effort paths,
- job-search workflows that scale,
- concrete trust controls,
- and owner tools that move from observation to control.

