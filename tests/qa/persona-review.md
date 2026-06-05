# Persona UX Review Script

Use this script for public-launch UX/UI/design and user-journey review. Capture
screenshots and findings under `qa-artifacts/persona-review/<date>/`.

## Review Rules

- Review desktop and mobile viewport behavior for each persona where the
  workflow exists.
- Start from the persona's realistic state, not from an ideal seeded account.
- Record exact blockers, confusing moments, visual issues, tone issues,
  accessibility issues, and regression candidates.
- Do not use real personal resumes, credentials, or private account data in QA
  artifacts.

## Personas

### First-Time Anxious Job Seeker

Goal: build enough trust to provide profile material.

Walkthrough:

- Sign up or sign in.
- Read the opening workspace and chat prompt.
- Add rough career notes and one supported file or public profile link.
- Confirm, edit, or reject at least one profile fact.
- Review role-family or seniority recommendation.

Pass criteria:

- The product feels reassuring, private, and clear.
- It asks only useful clarifying questions.
- Failure or thin-profile states explain the next action without blame.

### Senior/Executive User

Goal: get candid strategic positioning and a polished master resume.

Walkthrough:

- Use a profile with executive-level scope and measurable outcomes.
- Ask for strongest role lanes and resume improvement priorities.
- Generate or review the master resume.
- Export PDF/DOCX if ready.

Pass criteria:

- Advice is candid and grounded in saved facts.
- Resume language is senior without sounding generic.
- No invented claims, dates, credentials, or companies appear.

### Career Switcher

Goal: understand fit, gaps, and practical next steps.

Walkthrough:

- Provide experience from one domain and ask about another target role family.
- Paste a safe job URL or job text.
- Review fit, gaps, risks, and recommendation.

Pass criteria:

- Gaps are explained constructively.
- Fit recommendation does not overstate readiness.
- The next action routes back to profile enrichment or materials only when
  justified.

### Low-Data User

Goal: recover gracefully when the profile is too thin.

Walkthrough:

- Start with only a short note.
- Ask for a master resume.
- Ask for job-specific materials.

Pass criteria:

- Ready states remain locked until enough confirmed facts exist.
- The user receives a small, specific next step.
- The app does not fabricate substance.

### Returning Applicant

Goal: manage jobs, generated artifacts, and statuses.

Walkthrough:

- Open job history, applications, library, and settings.
- Review generated materials.
- Update an application status.
- Review follow-up or next-action details where available.

Pass criteria:

- Record-heavy pages are scannable and compact.
- Status updates feel reversible only where product rules allow.
- Artifacts and application records are clearly connected.

### Owner/Admin

Goal: monitor the product without seeing unnecessary personal data.

Walkthrough:

- Open owner/admin console.
- Review metrics and tier configuration.
- Attempt support-safe drill-down.
- Attempt a non-admin access path with a normal account.

Pass criteria:

- Aggregate metrics are useful.
- Tier changes are validated and audited.
- Non-admin access is denied.
- Raw resumes, cover letters, profile facts, and chat content do not appear.

### Frustrated Support User

Goal: get help without repeating discovery or exposing sensitive data.

Walkthrough:

- Open support from a blocked workflow.
- Submit a frustrated issue with a fake sensitive identifier.
- Review user-visible ticket state.
- Review L1 packet from an owner/admin perspective where available.

Pass criteria:

- Tone is concise and empathetic.
- Sensitive issues escalate to L2.
- Identifiers are redacted.
- Owner-only notes remain owner-only.

## Finding Format

Record each finding in this shape:

```json
{
  "persona": "career_switcher",
  "surface": "job_evaluation",
  "severity": "blocker | concern | note",
  "finding": "What happened.",
  "expected": "What should have happened.",
  "artifact": "qa-artifacts/persona-review/2026-06-05/career-switcher-job.png",
  "regressionCandidate": true
}
```
