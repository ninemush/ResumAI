# UX/UI Review - Public Launch Pass - 2026-06-02

Read-only audit completed by a UX/UI review subagent. No code changes were made during the review.

## Executive Read

Public launch readiness: 6.4 / 10.
Private beta readiness: 7.7 / 10.

Pramania is moving in the right direction. The information architecture is cleaner than earlier reviews described: Cockpit, Profile & Resume, Jobs, Applications, Library, Settings, with owner console gated. Mobile now has a bottom nav and chat/workspace switching. Resume preview is more trust-oriented. Jobs and Applications are more scan-first.

The remaining launch risk is still trust. The product sometimes feels like an intelligent career advisor, but the app can still expose workflow machinery: deterministic chat routing, status-heavy panels, credit mechanics, material/export states, archive/review filters, and internal-ish labels. For a consumer career product, the first 5-10 minutes must feel like "it understood me and made my story sharper," not "I am operating a resume database."

## P0 Launch Blockers

### P0: Chat Intent Must Become Intelligence-First

Before: `components/conversation/conversation-panel.tsx` routes through many deterministic branches before advisor handling. Ambiguous replies can still be misclassified.

After: one orchestrator pattern: interpret full workspace context, choose command, execute, verify state changed, then respond. Chat should never say an action happened unless the relevant panel state reflects it.

### P0: First-Session Trust Moment Is Not Guaranteed

Before: a user may drop a source, receive prose, and need to infer where the profile or resume changed.

After: first source intake should trigger a visible "What I learned" panel with 3-5 plain-English findings, source provenance, one best question, and a direct "Build my master resume" action.

### P0: Jobs Action Language Overclaims

Before: `components/jobs/job-ingestion-panel.tsx` uses "Apply," even though V1 does not submit applications.

After: replace with "Prepare packet," "Log + tailor," or "Create application packet." This is a trust/legal boundary issue, not copy polish.

### P0: Public Pricing Posture Is Not Launch-Ready

Before: public page says "Simple tiers are coming" while Settings/Credits already expose packs and mechanics.

After: for public launch, show concrete starter value, credit pack examples, and what a user can complete before paying. "Coming" is acceptable for private beta only.

## P1 Private Beta Must-Fix

### P1: Reduce Visible Machinery In Normal User UI

Before: "Resume actions," "Export needed," "Photo-safe," "Material review," "Ready for validated export," "Warnings," status pills, archive filters, and credits language compete with career guidance.

After: translate to user outcomes: "Resume ready," "Files ready," "Needs your review," "Prepare a focused version," and "Saved in Library."

### P1: Make Cockpit Less Dashboard-Like

Before: `components/profile/profile-explorer.tsx` uses many metric cards: Resume, Applications, Interviewing, No reply, Closed, Jobs to review, Library.

After: first screen should have three areas: Next best move, Your working direction, and Current applications. Keep metrics secondary or compact.

### P1: Resume Preview Is Improved But Still Surrounded By Controls

Before: `components/resume/master-resume-panel.tsx` shows a preview, then review panels, readiness panels, export panels, and variant panels.

After: default first view should be the resume document plus a small trust strip: Sources used, Claims to verify, Files. Put rebuild/export/variant controls in a right rail or collapsed action bar.

### P1: Application Review Editor Is Too Form-Like

Before: `components/applications/application-panel.tsx` opens "Material review" with textareas for resume, gaps, reviewer notes, and cover letter.

After: show final packet preview first. Editing should be a mode. Downloads and readiness should sit at top as a compact packet status.

### P1: Mobile Is Structurally Better But Crowded

Before: six bottom nav items: Cockpit, Resume, Jobs, Apps, Library, Chat.

After: mobile V1 should use four primary tabs: Chat, Profile, Jobs, Applications. Move Library and Settings into Profile or More. Six tabs with labels is dense for consumer mobile.

### P1: Card System Is Visually Overused

Before: CSS uses many bordered cards across every surface in `app/globals.css`, creating a modular dashboard feel.

After: reserve cards for repeated records. Use full-width quiet sections, dividers, and fewer bordered containers inside core flows.

## P2 Polish

- The beige/gold palette is elegant but too dominant. Add restrained functional color for success, caution, action, and selected states so the UI has more rhythm.
- Button labels should be more outcome-specific: "Generate" should become "Create tailored packet"; "Review" should become "Open packet"; "Archive" should become "Move out of current search."
- Empty states are good but should include one primary action every time, ideally "Drop resume," "Paste job link," or "Ask Pramania."
- Settings privacy copy is honest but too future-facing: "Export and deletion controls will be explicit before public launch" should not appear in a public launch UI.
- Owner console is strong operationally, but it should remain hidden from any consumer mental model and not influence user-facing IA.

## Recommended V1 IA

Desktop:

- Cockpit: next move, working direction, application pulse.
- Profile & Resume: source-backed profile plus master resume.
- Jobs: roles being evaluated, not applications.
- Applications: pursued roles and packets.
- Library: uploaded sources and generated files.
- Settings: account, privacy, credits, support.

Mobile:

- Default to Chat.
- Bottom nav: Chat, Profile, Jobs, Apps.
- Use sheets for packet downloads, source details, and settings.
- Chat should be the command surface; workspace tabs should show proof and records.

## Design Principles

- Make Pramania feel like a calm advisor, not a control panel.
- Every action must visibly land.
- Preview before edit.
- Use user-value language, not system-state language.
- One primary next action per screen.
- Keep paid/credit moments transparent and tied to meaningful outcomes.
- Do not use "apply" unless Pramania actually submits, which V1 must not do.

## What Would Make This Referable?

- A first upload produces: "Here are the three strongest things in your story."
- A master resume visibly improves messy experience into credible, specific impact bullets.
- A job link produces a candid "pursue / pause / not worth it" recommendation.
- A tailored packet appears with resume, cover letter, and explanation of what changed.
- Pramania remembers context when the user says, "make it more senior" or "use the COO direction."
- The app helps users feel less exposed and more in control during a stressful search.

## What Should Be Removed Or Hidden

- Hide "Photo-safe," "validated export," "warnings," "reviewer notes," raw status mechanics, and archive controls from first-level views.
- Remove "Apply" wording from Jobs.
- Hide advanced resume gap/reviewer fields unless editing.
- Move Library health/provenance details behind source detail views.
- Collapse owner/admin-only operational language entirely away from consumer UI.
- Reduce top-level metrics in Cockpit until the user has enough activity for them to matter.

## Bottom Line

Pramania is now a credible private beta candidate. For public launch, focus less on adding features and more on making the first session feel unmistakably intelligent: source in, profile understood, resume improved, next move clear, and no ambiguous machinery in the way.

