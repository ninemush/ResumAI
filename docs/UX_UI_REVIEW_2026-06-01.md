# Pramania UX/UI Review - 2026-06-01

## Executive Summary

Blunt read: Pramania has the right product ingredients and a much stronger foundation than before, but the user experience still exposes too much internal machinery. It feels like "dashboard plus chatbot" more than "an expert career advisor quietly organizing the work."

For launch in days, the risk is not lack of features. The risk is trust: users must see that Pramania understands them, improves their profile, produces a credible resume, and remembers what happened.

## Severity Legend

- `P0`: Launch blocker. Breaks trust or core workflow.
- `P1`: Must fix before private beta.
- `P2`: Polish / quality lift.
- `P3`: Post-launch / scale item.

## What Is Working

- The brand direction is strong: warm, calm, premium, and differentiated from generic SaaS.
- The consolidation toward `Library` is right: uploaded and generated materials belong together.
- The backend has real product depth: profile extraction, sources, job fit, applications, artifacts, support issues, owner metrics, credits.
- The master resume editor is moving in the right direction: contact fields, role chronology, exports, save/discard state.
- The owner console is more operational than most early products.
- The app now has meaningful e2e tests starting to encode UX regressions.

## P0 Findings

### 1. Conversational Pramania is still router-first, not intelligence-first

**Severity:** `P0`

**Area:** Conversational advisor

**Symptom:** User replies like "commercial/COO-style operations leadership" or "ok go do it" can hit the wrong deterministic branch.

**Why it matters:** This is the core product. If Pramania feels dumb, nothing else matters.

**User impact:** Users feel ignored, misunderstood, or forced to repeat context.

**Recommendation:** Make the LLM produce an intent/action plan from full workspace context, then execute commands, then have Pramania respond only with what actually happened.

**Implementation notes:** `components/conversation/conversation-panel.tsx` still has many deterministic branches before/around the advisor. Move toward one orchestrator: `interpret -> command -> verify -> respond`.

**Validation criteria:** Pramania must correctly handle follow-up answers, owner/admin questions, "what do you know about me," and "do it" commands without asking the user to repeat context.

### 2. Actions do not always visibly land

**Severity:** `P0`

**Area:** Cross-workspace action feedback

**Symptom:** "Use as direction," generate, apply, upload, and resume updates can produce chat text without the related surface visibly changing.

**Why it matters:** The workspace must prove that Pramania is acting, not just talking.

**User impact:** The user thinks Pramania is lying or pretending.

**Recommendation:** Every successful action should update the relevant panel, show a concise confirmation, and highlight the affected record.

**Validation criteria:** After "set this as my direction," the Cockpit/Profile target visibly changes. After "generate materials," the application row shows PDF/DOCX status and download actions.

### 3. Master resume is not yet the trust moment

**Severity:** `P0`

**Area:** Profile & Resume

**Symptom:** The resume still looks like an editor/form in places, with visible controls inside the resume, cramped sections, clipping risks, and chronology issues.

**Why it matters:** The master resume is the main proof that Pramania understands the user.

**User impact:** Users lose confidence that Pramania can produce materials worth submitting.

**Recommendation:** Default to polished final-resume preview. Editing should be layered behind an Edit mode. Chronological experience should dominate: company, role, dates, location, bullets.

**Implementation notes:** `components/resume/master-resume-panel.tsx` has the right data surface but needs a clearer preview/edit separation.

**Validation criteria:** First view looks like a resume someone would actually submit. No clipped title, no internal heading like "Master ATS Resume," no recommendations under work experience.

### 4. LinkedIn/Profile PDF parsing is still not reliable enough

**Severity:** `P0`

**Area:** Profile ingestion

**Symptom:** Recommendations/testimonials have appeared as work experience; structured LinkedIn PDF content is not always reconstructed correctly.

**Why it matters:** Resume/profile ingestion is the lowest-friction onboarding path.

**User impact:** Users see bad resume structure and lose trust quickly.

**Recommendation:** Add a semantic classification pass before resume generation: `work_experience`, `recommendation`, `education`, `skills`, `certification`, `summary`, `noise`. Do not let unclassified text enter work history.

**Validation criteria:** `downloads/profile.pdf` should produce clean UiPath/GE/GE Capital chronology, with recommendations stored separately or ignored for resume chronology.

### 5. Job-to-application-to-materials flow must be closed-loop

**Severity:** `P0`

**Area:** Jobs and applications

**Symptom:** Users click Generate but may not know whether anything happened or where the files are.

**Why it matters:** This is the core paid-value loop.

**User impact:** Users cannot trust the app to support real applications.

**Recommendation:** For each application, show: role, company, stage, fit, resume status, cover letter status, PDF/DOCX links, next action.

**Validation criteria:** Paste job URL -> fit read -> user approves -> application logged -> tailored resume/cover letter generated -> files visible in Applications and Library.

## P1 Findings

### 6. Mobile is still a stacked desktop, not a mobile product

**Severity:** `P1`

**Recommendation:** Mobile should have bottom nav, one active surface at a time, and Pramania as docked/fullscreen chat.

**Validation criteria:** On iPhone Safari, no overlapping chat, no horizontal nav scroll, no giant stacked dashboard.

### 7. Jobs and Applications need scan-first records

**Severity:** `P1`

**Symptom:** Detail still expands inline and can become overwhelming.

**Recommendation:** List/table rows with drawer details: `Role | Company | Fit/Stage | Materials | Next action`.

**Validation criteria:** Seed 25 jobs and 25 applications. User should scan status in under 30 seconds.

### 8. Chat rendering needs proper rich text

**Severity:** `P1`

**Symptom:** Raw markdown, long paragraphs, and dense text reduce comprehension.

**Recommendation:** Render markdown into headings, bullets, short paragraphs, callouts, and "show more" for long advice.

**Validation criteria:** No visible `**`, malformed bullets, or wall-of-text replies.

### 9. Wait states need context and progression

**Severity:** `P1`

**Recommendation:** Replace generic looping messages with task-specific states: "Reading your PDF," "Separating roles from recommendations," "Updating your resume," "Saving the draft."

**Validation criteria:** During a 20-30 second task, messages do not repeat and accurately reflect what is happening.

### 10. Library should feel like provenance, not homework

**Severity:** `P1`

**Recommendation:** Keep `Uploaded` and `Generated`, but make it a calm file cabinet. Hide internal health cards unless something needs attention.

**Validation criteria:** User can find and download the original uploaded resume/Profile PDF in under 10 seconds.

### 11. Owner console is promising but still needs actionability

**Severity:** `P1`

**Recommendation:** Each error/root cause should open a drilldown with affected users, timeline, logs, suspected cause, suggested fix, status, notes, and user notification state.

**Validation criteria:** Owner can triage one issue without touching SQL or logs manually.

### 12. Credits/paywall must be impossible to misunderstand

**Severity:** `P1`

**Recommendation:** Show current credits, what costs credits, usage warnings at 50/75/90%, blocked-state CTA, promo apply, and receipt confirmation.

**Validation criteria:** Sandbox purchase returns to Pramania and updates credits reliably.

### 13. Support needs an explicit path

**Severity:** `P1`

**Recommendation:** Keep chat-assisted support, but add "Report issue" wherever an action fails and in Settings/Support.

**Validation criteria:** Failed export can create a support ticket with context attached.

### 14. Landing/auth is close, but must not overpromise

**Severity:** `P1`

**Recommendation:** Be precise: resume, LinkedIn PDF/export, public URLs where available. Avoid implying public LinkedIn import is flawless until it is.

**Validation criteria:** First-time user knows the best first action immediately.

## P2 Findings

### 15. Visual hierarchy still has density problems

**Severity:** `P2`

Large cards plus white space make one record feel heavy. Operational pages need rows, not cards.

### 16. Some user-facing labels are internal

**Severity:** `P2`

Remove terms like signals, readable characters, fact counts, source health, root cause from normal user UI. Translate to value: "resume ready," "needs stronger metrics," "files saved," "needs attention."

### 17. Iconography needs stricter rules

**Severity:** `P2`

Avoid duplicate icon meanings, such as the double camera/profile upload icon. Use one primary icon per action.

### 18. Accessibility needs a pass

**Severity:** `P2`

Check keyboard navigation, aria labels for icon-only buttons, tab roles, focus states, contrast on tan text, and touch target size.

### 19. Trust/privacy language should be visible but not legalistic

**Severity:** `P2`

Users need to feel: "you control what is saved, exported, and used." Terms/privacy can be deeper, but trust cues should appear in-product.

### 20. Empty/error states should never dead-end

**Severity:** `P2`

Every failure should say: what happened, what was preserved, what Pramania will retry, and what the user can do next.

## Quick Wins: 1 Day

- Add proper markdown rendering in chat.
- Rename "Use as direction" to "Set as my target direction" and visibly update the target chip.
- Hide internal counts from user UI.
- Add explicit "Report issue" button to failed states.
- Collapse Library health/status cards.
- Add direct download buttons for uploaded sources.
- Add toast/highlight when actions update another panel.
- Seed 10-25 records in QA to catch bad density.

## Critical Next 3 Days

- Rework conversation orchestration into LLM intent/action/confirmation flow.
- Fix LinkedIn/Profile PDF classification and chronological resume reconstruction.
- Make master resume preview-first with clean edit mode.
- Complete job -> application -> generated materials -> PDF/DOCX -> Library e2e.
- Implement mobile bottom nav and one-active-surface layout.
- Verify RevenueCat/Stripe sandbox purchase and credit update end-to-end.

## Post-Launch Backlog

- BI-grade owner analytics.
- Autonomous L1 support assistant.
- Authenticated LinkedIn integrations.
- Job board integrations.
- Native app shell.
- Experimentation and onboarding optimization.

## Bottom Line

Do not add more features yet. The highest-value next move is a UX consolidation pass around Pramania-as-intelligence, master resume quality, mobile flow, and visible action completion. That is what will make users trust the product in the first 5-10 minutes.
