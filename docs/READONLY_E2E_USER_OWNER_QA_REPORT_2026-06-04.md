# Pramania Read-Only E2E User + Owner QA Report

Date: 2026-06-04  
Method: read-only multi-agent persona QA, automated Playwright baseline, signed-in demo workspace inspection, owner console sweep.  
Primary baseline: `docs/USER_SIMULATION_QA_REPORT_2026-06-03.md`  
Write safety: no code changes, no purchases, no promo redemption, no owner/admin mutations, no destructive actions.  

## Completion Status

This activity is complete as a read-only QA pass.

Automated baseline:

- `npm run test:e2e`
- Result: 95 passed, 7 intentionally skipped
- Desktop and mobile returning-user journey artifacts reported 0 automated findings and 0 console errors.

Agent coverage:

- 6 delegated persona agents completed.
- Hub agent completed product/UX designer, returning user, credits/recharge, and owner console sweeps.
- The platform capped active subagents at 6, so remaining personas were covered from the hub instead of spawning more agents.

Artifacts:

- Automated screenshots: `qa-artifacts/user-journey-qa/chrome-desktop/`
- Automated screenshots: `qa-artifacts/user-journey-qa/chrome-mobile/`
- Owner/manual read-only screenshots and text summary: `/private/tmp/pramania-readonly-qa/`

## Executive Summary

Pramania is materially stronger than the June 3 baseline. The core surfaces now exist and mostly work: Profile cockpit, Profile & Resume, compact Jobs and Applications, Library split into Uploaded and Generated, Settings with credit usage and history, Support, and a real Owner Console. The signed-in demo account showed strong returning-user memory: chat remembered the saved RevOps/GTM profile, answered lane questions from current context, and did not ask the user to repeat obvious known facts.

The biggest remaining launch risks are not missing screens; they are trust and proof. Users still need Pramania to show exactly what it learned, what changed in the workspace, what remains uncertain, and which next action matters. The clearest trust break is in the master resume: the demo Library has a ready/profile-ready source, but the resume still says there is no role-by-role work history. For many personas, that single mismatch makes the product feel less reliable than the chat itself.

Owner Console is functionally rich but needs layout attention. It exposes operating metrics, user activity, root-cause errors, support tickets, outcomes, profitability, promo codes, and credit tools. However, in the read-only owner screenshot pass, the overview content collapsed into a narrow column and text stacked letter-by-letter. Owner work also feels cramped by the persistent chat rail; the owner console likely needs a focused/full-width mode.

## Highest Priority Findings

### P0 / P1 - Master Resume Trust Moment Still Breaks

Observed: Profile & Resume shows a polished summary and highlights, but Professional Experience says: “No role-by-role work history yet.” At the same time, Library shows a ready/profile-ready uploaded source.

Why it matters: This directly undermines the first-upload proof moment. A user who gave Pramania a resume expects company, title, dates, and role bullets to appear or a precise explanation of why they did not.

Recommendation:

- Treat “source exists but no chronology” as a failed proof state unless the source truly lacks work history.
- Add a source proof receipt that says what was read, what facts were added, what changed in the profile/resume, what failed, and what needs confirmation.
- Add a Profile & Resume trust strip: sources used, claims to verify, unsupported claims excluded.

### P1 - First-Upload / First-Note Proof Is Not Durable Enough

Source intake has a structured “what I learned” pattern, but typed rough notes and some persona-specific evidence paths do not get the same visible receipt.

Recommendation:

- Reuse the same receipt format for files, links, screenshots, LinkedIn exports, and rough notes.
- Receipt sections should include: Added, Inferred carefully, Needs confirmation, Updated workspace areas, Next best action.
- The chat should only claim an action succeeded when the workspace actually updates.

### P1 - Owner Console Layout Can Collapse

The read-only owner overview screenshot at `/private/tmp/pramania-readonly-qa/surface-ownerOverview.png` shows the main owner heading and intro text stacked into a very narrow column while other controls span the row. Owner Users/Errors/Support are richer, but still crowded.

Recommendation:

- Give Owner Console a focused/full-width mode or suppress/collapse the chat rail while owner work is active.
- Add min-width constraints for owner header/content.
- Verify owner tabs at desktop widths with screenshots, not just existence checks.

### P1 - Mobile Nav Omits Library

Mobile bottom nav shows Chat, Profile, Jobs, Apps. The June 3 checklist recommended Chat, Profile, Jobs, Apps, Library. Library is the evidence/provenance surface, so hiding it weakens trust after uploads.

Recommendation:

- Add Library to mobile nav, or add an obvious evidence link from Profile/Chat after source intake.
- Expose Credits/Settings from Profile for mobile users who need recharge clarity.

### P1 - Rough-Note / No-Resume Intake Needs To Be Explicit

The product technically supports text, images, OCR, and domain prompt packs, but no-resume users do not see an obvious “start with messy notes” path.

Recommendation:

- Add starter chips: “I do not have a resume,” “Use rough notes,” “Take a photo of a certificate,” “Talk it out.”
- Broaden rough-note detection for titles, credentials, comma-separated fragments, mobile shorthand, and frontline operations terms.

### P1 - Healthcare Privacy Needs In-Product Warnings

Legal/privacy pages cover responsibility and AI processing, but healthcare users need warnings at the upload/support moment.

Recommendation:

- Add upload-adjacent copy: “Do not upload patient names, MRNs, DOBs, clinical notes, or unauthorized PHI.”
- Add PHI-safe examples and support-ticket warnings.
- Add source removal/account export/deletion controls or a clearly visible path.

### P1 - Regional Resume Norms Are Not First-Class

The UAE/India mobile-first persona needs current location, target market, work authorization, relocation, notice period, languages, and CV/resume-market preference. These are not first-class profile fields.

Recommendation:

- Add target geography, authorization/sponsorship, relocation, notice period, language, and market-format fields.
- Add guidance for UAE/India/UK/US resume norms with privacy-safe caveats.

## What Is Working

- Brand tone still lands: calm, serious, private, and premium.
- Returning-user memory is real in the demo account.
- Chat can answer context questions like role lanes, jobs/applications count, and credit status.
- GTM/RevOps domain intelligence is strong.
- Engineering, logistics, healthcare, and early-career prompt packs exist in code.
- Jobs and Applications have compact structures, active/archive affordances, and clear empty states.
- Library has Uploaded and Generated tabs, source status, download, preview, and retry concepts.
- Settings explains account, balance, password reset, usage history, purchase history, invoices, promo codes, and credit packs.
- Public `/credits` page clearly explains what costs credits, what is free, typical journeys, low balance behavior, and no auto-charge/no auto-renew.
- Owner Console has meaningful operating data, root-cause categories, support issue context, suggested fixes, user activity, outcomes, profitability, and promo/credit controls.
- Mobile first-session is much improved: chat-first and one active surface at a time.

## Automated Baseline

Command run:

```bash
npm run test:e2e
```

Result:

- 95 passed
- 7 skipped

Covered by existing tests:

- Public landing page, terms, privacy, credits guide
- Auth requirement for protected APIs
- Signed-in workspace without marketing page or hydration overlay
- File intake accept list
- Mobile chat-first/profile/jobs/apps behavior
- Advisor context quality
- Compact record-heavy desktop surfaces when records exist
- Master resume horizontal overflow
- Owner console availability for owner demo account
- Unsaved resume edit navigation guard
- Resume-source chronology parsing unit tests

Automated journey artifacts:

- Desktop findings: `qa-artifacts/user-journey-qa/chrome-desktop/findings.json` -> 0 findings, 0 console errors
- Mobile findings: `qa-artifacts/user-journey-qa/chrome-mobile/findings.json` -> 0 findings, 0 console errors

Note: a separate read-only owner capture script observed a hydration mismatch warning involving input `style={{caret-color:"transparent"}}`. The main Playwright E2E suite did not report hydration failures, so this should be monitored but is not currently treated as a launch blocker.

## Hub Sweep Notes

### Returning User

Observed:

- Desktop cockpit opens with Jordan Hale’s name, title, next best move, resume/application/job/library status, and chat context.
- Chat remembered prior context and gave a credible answer about forecast accuracy and RevOps positioning.
- Settings shows credit balance and usage.
- Library count exists in cockpit.

UX read:

- Strong for a mature profile.
- Needs a “since your last visit” strip to better match the June 3 recommendation.
- Repeated chat history can visually crowd the right rail.

Recommendation:

- Add “Since your last visit”: new sources, resume changes, applications needing follow-up, support updates, credits used, recommended next move.

### Credits / Recharge

Observed:

- Public credits page is clear and calm.
- Settings shows current balance, used credits, usage history, purchase history, invoice history, promo code redemption, and add-credit packs.
- Chat can answer “What credits do I have?” but only generically: “Settings is the right place to review balance and usage.”

Read-only boundary:

- No live checkout/purchase was completed.
- Recharge was inspected up to the visible pack/guide boundary.

Recommendation:

- Add point-of-action credit previews: “Create packet - 5 credits,” “Export files - 1 credit.”
- Make chat answer the exact current balance and recent usage when asked, not just redirect to Settings.
- Add warnings at 50%, 75%, and 90% if not already active in runtime state.

### Product / UX Designer Persona

Observed from hub/code/static sweep:

- Library and resume surfaces are visually polished but very type-heavy.
- Portfolio intake is not first-class enough; generic link/screenshot/PDF intake exists, but there is no designer-specific evidence-to-bullet workflow.
- Master resume is ATS-oriented and clean, but the product should show how portfolio evidence becomes ATS-safe bullets without flattening voice.

Recommendations:

- Add portfolio-specific source type or post-upload classifier.
- Add “Evidence -> resume bullet” side-by-side transformations for design case studies.
- Prompt for usability, conversion, activation, design systems, research, launch impact, stakeholder alignment, and portfolio URL/PDF/screenshot evidence.

### Owner Console

Surfaces inspected:

- Overview
- Users
- Errors
- Support
- Outcomes
- Public credits and Settings support context

What works:

- Operating metrics are meaningful.
- Users table shows activity, profile status, source count, credits, applications, resume count, active tier, and support.
- Errors view has root-cause groups such as resume generation, client runtime, and needs triage.
- Support view includes plain-English root cause, suggested fix, logs/context, status, owner notes, and actions.
- Outcomes view breaks down tier, role family, source, resume type, and time to first response.

Issues:

- Overview layout collapsed in the read-only screenshot pass.
- Owner tabs are horizontally crowded and “Promo codes” can clip.
- User table labels and email fields wrap heavily.
- Support issue cards are useful but cramped.
- Owner console competes with persistent chat for horizontal space.
- Owner actions are powerful; read-only mode or confirmation affordances would reduce accidental mutation risk during review.

Recommendations:

- Add full-width owner mode.
- Add owner read-only/review mode.
- Add visual regression coverage for owner overview, users, errors, support, outcomes.
- Keep support actions but add clearer “this will notify user / this only saves owner notes” distinctions.

## Per-Agent Reports

### Agent 1 - Recent Graduate / Marketing Analyst

Persona:

- Anxious first-time user with thin experience.
- Needs reassurance that class projects, internships, part-time work, club leadership, tools, and learning velocity count.

Surfaces tested:

- Public entry page
- Sign-in/create-account
- Email code gate
- Signed-in Cockpit
- Profile & Resume
- Library
- Jobs
- Applications
- Settings
- `/credits`
- Mobile first session

Findings:

- High: Profile & Resume trust moment is fragile because Library can show a ready source while resume says work history is missing.
- High: Desktop first session opens on Cockpit, which can feel evaluative before trust is earned.
- Medium-high: typed thin-experience intake does not get the same structured proof receipt as file/source intake.
- Medium: early-career intelligence exists, but it is not marketing-analyst specific enough.
- Medium: visible gap language like “critical,” “role evidence,” and “seniority level” may feel shaming for thin users.
- Medium: auth/terms copy is legally sensible but responsibility-heavy.
- Low-medium: credit clarity is strong, but first paid action needs a credit preflight.
- Low-medium: mobile first-session is strong, but mobile nav omits Library/Settings.

Recommendations:

- Make new/low-evidence desktop sessions chat-first.
- Add “You are not starting from zero” copy.
- Add early-career chips and marketing analyst prompts.
- Reuse source proof receipt for rough text notes.
- Soften gap labels into “Most useful next detail.”
- Fix ready-source vs missing-work-history mismatch.

### Agent 2 - Backend / Software Engineer

Persona:

- Senior IC skeptical of generic resume tools.
- Needs GitHub, systems, architecture, reliability, scale, migrations, incidents, and OSS evidence.

Surfaces tested:

- Auth/MFA
- Cockpit
- Profile & Resume
- Jobs
- Applications
- Library Uploaded
- Library Generated
- Settings
- Mobile Chat/Profile
- Advisor API memory probes

Findings:

- P1: Master resume still fails chronology trust moment.
- P1: Library counts/status are inconsistent. Source card can show Ready/Profile-ready while filter counts show Ready 0 / Needs help 1. Generated tab can show a resume while counts say Resumes 0 / Cover letters 1.
- P1/P2: GitHub is not first-class enough. Generic link intake exists, but no GitHub-specific repo/README/language/OSS/project extraction was evident.
- P2: Advisor memory is strong and challenged the backend mismatch correctly, but raw markdown leaked in API output.
- P2: Job-fit surface is structurally ready, but senior backend fit quality is unproven in demo state.

What worked:

- Broad source intake accept list.
- Engineering prompt pack exists.
- Chat remembered saved RevOps profile and jobs/applications count.
- Export affordances are visible.
- Mobile first-session behavior is directionally right.

Recommendations:

- Fix master resume chronology.
- Add GitHub-specific ingestion and an “engineering evidence found” panel.
- Fix Library status/count derivation.
- Add source proof summary per upload/link.
- Preserve advisor’s ability to challenge mismatched target roles.
- Strip/render markdown consistently.

### Agent 3 - Senior GTM / RevOps Leader

Persona:

- Director-level operator evaluating strategic lane clarity and application support.

Surfaces tested:

- Prior QA checklist
- Code/tests
- Public credits
- Signed-in workspace
- Advisor route

Findings:

- P1: First-upload proof moment is still too generic. It does not show concrete facts added, fields updated, inferred assumptions, unresolved GTM/RevOps proof gaps, or whether master resume refreshed.
- P1: Lane clarity is strong in chat but not durable enough in Profile cockpit. Chat can say primary/secondary/avoid, but cockpit shows “Directions worth considering.”
- P1: Target level gap appears despite director-level evidence.
- P2: Jobs and Applications are compact, but “next action” is not first-class.
- P2: Material generation/export buttons need point-of-action credit preview.
- P2: Mobile bottom nav omits Library.
- P2: Applications workflow is functional but not yet a complete operating loop.
- P3: Raw markdown risk remains in advisor responses.

Recommendations:

- Add source proof receipt and workspace-visible first-upload proof.
- Add durable lane strategy panel: Primary lane, Secondary lane, Avoid for now, Why, Proof needed, Resume implication.
- Infer/suggest target level from headline/recommendation, then ask for confirmation.
- Add next action fields to Jobs and Applications.
- Add credit cost labels to costly action buttons.
- Add Library to mobile nav.

### Agent 4 - Healthcare / Clinical Operations Manager

Persona:

- Privacy-sensitive healthcare operations leader.
- Needs domain-specific metrics and safe handling of patient-related data.

Surfaces checked:

- Prior QA checklist
- Code
- Privacy/terms
- Source intake
- Profile & Resume
- Library
- Settings
- Support
- Owner-console support flow
- Authenticated local app

Findings:

- High: No explicit PHI warning at upload/chat intake.
- High: AI processing/storage/deletion details are too abstract in-product.
- High: No visible direct delete/export controls for uploaded originals.
- High: Support context capture can collect sensitive healthcare text; redaction is not PHI-specific enough.
- Medium: Healthcare metric intelligence exists but is not surfaced as an obvious detected domain mode.
- Medium: Source provenance is good in Library but weak in resume/advisor proof moments.
- Medium: Support loop is visible but reply/update path is indirect.
- Medium: Settings security is solid but incomplete for privacy-sensitive buyers.
- Low: Multiple identical “Open support” controls can be ambiguous.

Recommendations:

- Add PHI warning at upload, support, source preview, and deletion/export surfaces.
- Add healthcare-safe intake examples.
- Add account export/delete/source removal controls.
- Add PHI-aware support-ticket prevention.
- Surface healthcare domain prompts when healthcare terms are detected.

### Agent 5 - Logistics / Operations Supervisor

Persona:

- Practical mobile-first user with rough notes, certificates/photos, and no polished resume.

Surfaces tested:

- Prior QA checklist
- Code
- Live local app with demo auth
- Mobile behavior
- Jobs/Applications/Support paths

Findings:

- P0: rough-note/no-resume intake can miss this persona. Very rough notes may route to advisor instead of saved profile evidence.
- P1: first-time no-resume path is not obvious enough.
- P1: mobile nav omits Library and Support.
- P1: certificate/photo support exists technically but is under-signposted; HEIC/HEIF is rejected.
- P2: logistics metric prompts are strong but may surface too late.
- P2: Jobs and Applications are improved, but 10+ record density needs seeded fixture proof.
- P2: Support loop is conceptually good but too indirect for practical users.

What works:

- Image/OCR, voice input, file intake, Library history, logistics prompt packs, credit transparency, and compact Jobs/Applications structure are real foundations.

Recommendations:

- Add explicit rough work notes mode.
- Add starter chips for no-resume users.
- Add certificate-photo copy near attach.
- Consider HEIC conversion support.
- Trigger logistics examples immediately on warehouse/dispatch/inventory/fleet/supervisor terms.
- Add mobile Help/Support affordance.

### Agent 6 - International UAE/India Mobile-First Candidate

Persona:

- Mobile-first international candidate targeting UAE/India or cross-market roles.
- Needs CV/resume norm guidance, authorization, languages, relocation, and credit clarity.

Surfaces inspected:

- Prior QA checklist
- Local mobile app surfaces reachable
- Auth/email-code gate
- Mobile auth and credits pages
- Code/static inspection

Findings:

- High: target geography, authorization, relocation, and regional CV preferences are not first-class profile data.
- High: regional resume norms are not explicitly guided.
- High: returning login can strand mobile users at email-code verification. No visible password reset, alternate sign-in, or “cannot access this email” path on the MFA gate.
- Medium: mobile nav is improved, but credits/settings are secondary.
- Medium: language skills are preserved if extracted but not deliberately elicited.
- Medium: QA coverage does not include this persona as executable path.
- Positive: credit clarity is strong.

Recommendations:

- Add structured fields for target geography, work authorization/sponsorship, relocation, notice period, languages, and resume-market preference.
- Add UAE/India/US/UK regional resume guidance.
- Add first-session mobile prompt for target market.
- Improve MFA recovery/alternate path.
- Add automated persona coverage for UAE/India mobile journey.

### Hub Agent - Product / UX Designer

Persona:

- Designer with portfolio evidence and sensitivity to UI quality.

Findings:

- Portfolio evidence is not first-class enough.
- Library is conceptually right but should show clearer evidence-to-output transformation.
- Master resume design is clean and ATS-safe, but the app should preserve designer voice while showing why content changed.
- UI polish is generally strong, but cramped owner/settings tables and awkward email wrapping weaken the premium feel.

Recommendations:

- Add portfolio source handling for URL/PDF/screenshots.
- Add side-by-side evidence-to-bullet transformations.
- Prompt for research impact, conversion, activation, usability, design systems, stakeholder alignment, and launch outcomes.
- Add visual regression coverage for dense/long-content states.

## Action Register

| Priority | Area | Action |
| --- | --- | --- |
| P0/P1 | Master Resume | Fix chronology when source evidence exists; show exact reason when chronology cannot be built. |
| P1 | Source Intake | Add workspace-visible proof receipt for every file/link/note. |
| P1 | Owner Console | Fix collapsed overview layout; add full-width/focused owner mode. |
| P1 | Mobile | Add Library to bottom nav or evidence deep link. |
| P1 | No Resume | Add rough-note and no-resume starter paths. |
| P1 | Healthcare | Add PHI warnings and healthcare-safe intake guidance. |
| P1 | International | Add target geography, work authorization, languages, and market-format guidance. |
| P1 | Library | Fix status/count inconsistencies across Uploaded and Generated. |
| P2 | Jobs/Applications | Add explicit next action and due/follow-up fields. |
| P2 | Credits | Add point-of-action credit cost labels/preflight. |
| P2 | Support | Add clearer user reply/update path and PHI-safe warnings. |
| P2 | Engineering | Add GitHub-specific ingestion and engineering evidence panel. |
| P2 | Design | Add portfolio-specific intake and evidence-to-bullet transformation. |
| P2 | QA | Add seeded 10+ Jobs/Applications fixtures and visual regression coverage. |
| P2 | Auth | Add MFA recovery/alternate sign-in path. |
| P3 | Advisor | Normalize markdown before returning/displaying advisor responses. |

## Suggested Next Workstream

1. Fix master resume chronology and Library status/count mismatches.
2. Build the source/note proof receipt and attach it to chat, Library, and Profile & Resume.
3. Repair Owner Console layout and add full-width owner mode.
4. Add mobile Library access and rough-note/no-resume entry points.
5. Add healthcare PHI warnings and international target-market fields.
6. Add point-of-action credit preflight labels.
7. Add seeded QA fixtures for dense Jobs/Applications/Owner states and persona-specific tests.

