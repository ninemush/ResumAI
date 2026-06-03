# Pramania Multi-Persona Simulation QA Report

Date: 2026-06-03  
Method: master-agent coordinated review with 10 persona subagents.  
Scope: simulated first-use and returning-use journeys across career levels, industries, confidence levels, input quality, and device expectations. No production data was changed.

## Executive Read

Pramania has the right emotional promise: calm, private, conversation-first career help that turns scattered career evidence into stronger positioning and application materials. Across personas, the brand tone was consistently described as warm, premium, serious, and less transactional than most resume tools.

The main risk is still the first proof moment. Users will stay if Pramania quickly proves, in plain language, that it understood their background, extracted the right evidence, and knows what to do next. Users will leave if they see internal machinery, generic prompts, missing chronology, placeholder output, or repeated requests for information they already provided.

The simulation confirms that Pramania should feel less like a dashboard plus chatbot and more like a career advisor with a workspace that quietly organizes the work. That means the conversation layer must be context-aware, state-aware, and action-aware, while the workspace must make every action visibly land.

## Scorecard

| Persona | Activation | Trust | Guidance | Output | Return / Referral | Overall Read |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Recent graduate / marketing analyst | 6 | 7 | 6 | 6 | 5 | Warm, but risks making early-career users feel underqualified. |
| Backend / software engineer | 7 | 6 | 8 | 6 | 7 | Strong potential, but chronology and GitHub/project evidence must be first-class. |
| Senior GTM / RevOps leader | 7 | 7 | 8 | 8 | 7 | Good strategic read; needs sharper first-upload proof and lane strategy. |
| Career changer / teacher to CS-enablement | 7 | 8 | 7 | 7 | 6 | Emotionally strong; needs transferability bridge and confidence-safe prompts. |
| Healthcare / clinical operations manager | 7 | 6 | 8 | 7 | 7 | Strong fit; needs healthcare privacy reassurance and domain-specific metrics. |
| Executive VP / board advisory | 6 | 7 | 7 | 7 | 6 | Premium enough, but must prove executive-level understanding faster. |
| International UAE/India mobile-first candidate | 2* | 3* | 2* | 1* | 2* | Agent hit a local setup surface; underlying finding: geo/resume-norm support is underdeveloped. |
| Product / UX designer | 3* | 3* | 2* | 2* | 2* | Agent hit a local scaffold; underlying finding: portfolio evidence must become resume evidence. |
| Logistics / operations supervisor | 5* | 7 | 5 | 4 | 5 | Good brand fit; rough-note and no-resume paths need to be real and obvious. |
| Returning user with applications / credits / support | 3* | 3* | 2* | 3* | 2* | Agent hit a limited local surface; underlying finding: returning-user orientation is critical. |

`*` These scores were influenced by local or environment-sensitive views rather than the fully configured production site. The qualitative friction is still relevant and should be treated as a launch-risk signal, not a literal production score.

## Cross-Persona Patterns

### What Is Working

- The brand tone lands: warm, calm, private, and serious.
- The product concept resonates across seniority levels, from recent graduate to executive.
- Chat-first intake is the right strategic direction.
- Users value candid talent-advisor guidance more than generic resume generation.
- Role-lane recommendations are a meaningful differentiator when grounded in the user's actual background.
- The privacy posture is an advantage, especially for healthcare, senior executives, and anxious job seekers.
- The standard ATS resume template direction is right, provided the content is complete and chronologically structured.

### Where Users May Abandon

- The app does not always visibly prove what it learned after an upload, link, or note.
- Users do not want internal counts such as signals, fact counts, readable characters, or parser language.
- If resume chronology is missing or duplicated, trust drops immediately.
- If Pramania asks for context already provided, users perceive it as a generic chatbot.
- If Pramania says it did something but the workspace does not update, users feel misled.
- Users with messy or no resume need a clearer "start with what you remember" path.
- Designers, engineers, healthcare operators, and logistics users need domain-specific evidence prompts.
- Mobile must not feel like stacked desktop panels.
- Returning users need a clear "what changed, what needs attention, what is next" entry point.

## Highest-Impact Launch Fixes

### 1. First-Upload Proof Moment

After any resume, LinkedIn PDF, profile link, portfolio, screenshot, or long note, Pramania should show:

- What I learned.
- What I added to your profile.
- What I inferred but will treat carefully.
- What still needs clarification.
- The strongest working direction.
- One next best action.

This should update the workspace, not only chat. The source should appear in Library, the master profile/resume should visibly change, and Pramania should only claim success if the underlying command succeeded.

### 2. Master Resume as the Trust Moment

The master resume must look like a finished ATS artifact first, with editing layered in. It must include:

- Name.
- Contact details, including email, phone when provided, LinkedIn/profile links when provided.
- Headline/title that does not clip.
- Professional summary.
- Core skills.
- Selected highlights immediately after skills.
- Chronological work experience by company, title, dates, location, and bullets.
- Optional sections only when available: projects, certifications, languages, education.
- No duplicate roles, recommendations, or endorsements in work experience.
- Clean PDF/DOCX export with no clipped text.

If the source contains work history, the resume must not say work history is missing.

### 3. Conversation Orchestration

Pramania should be the intelligence layer, not a deterministic intent router. It must answer questions such as:

- What did you learn from my profile PDF?
- What jobs am I tracking?
- What should I do next?
- What credits do I have?
- What issues are open?

The answer should use current workspace context, not ask the user to repeat known facts. Commands can execute behind the scenes, but the final response should be grounded in actual command results.

### 4. Domain-Specific Evidence Prompting

The personas showed that generic metric prompts are not enough. Pramania needs tailored prompts by domain:

- GTM / RevOps: pipeline, forecast accuracy, conversion, quota, revenue influence, sales cycle, funnel leakage, governance.
- Engineering: systems owned, scale, latency, reliability, architecture, code quality, incidents, migrations, developer velocity, OSS.
- Healthcare operations: patient access, throughput, staffing, quality, compliance, EHR adoption, revenue cycle, wait time, utilization.
- Logistics operations: throughput, late shipments, inventory accuracy, staffing, safety, dispatch, order volume, overtime, equipment/systems.
- Design: portfolio outcomes, research impact, conversion, activation, usability, design systems, stakeholder alignment, launch impact.
- Early career: project scope, class/client work, part-time responsibility, tools, leadership, learning velocity.
- Career changer: transferable skills, audience/stakeholder coaching, adoption, enablement, training outcomes, customer-facing proof.

The question style should be gentle and practical: "Was this closer to 10, 50, or 100 orders per shift?" is better than "quantify your impact."

### 5. Compact Jobs and Applications

Jobs and Applications must stay scannable with 10+ records:

`Role | Company | Fit / Stage | Materials | Next action`

Details should open in a drawer or focused panel. Active and Archived views should be available, and record-level archive/unarchive must persist.

### 6. Library as Evidence, Not Storage

Merge Sources and Artifacts into Library with two tabs:

- Uploaded: original files, links, screenshots, profile PDFs, notes, source status, download original, retry when needed.
- Generated: master resumes, role-specific resumes, cover letters, exports, versions, timestamps, job/application context.

Library should answer: "What did Pramania use to build my profile?"

### 7. Returning-User Orientation

Returning users need a calm command center:

- Since your last visit.
- Applications needing follow-up.
- Recently generated documents.
- Open support issues.
- Credit balance and recent usage.
- One recommended next move.

This should not feel like an analytics dashboard; it should feel like a career advisor remembering the work.

### 8. Credit Transparency

Users need to know:

- Current balance.
- What costs credits.
- What does not cost credits.
- Examples of common workflows.
- Warnings at 50%, 75%, and 90%.
- Purchase history and invoices.
- No auto-charge language.

Credit consumption should never surprise the user.

### 9. Support Issue Loop

Users need a simple way to report an issue from chat or Settings. Owners need:

- User.
- Context.
- Related logs.
- Plain-English summary.
- Root-cause hypothesis.
- Suggested fix.
- Status, aging, owner notes, and resolution.
- User notification path when fixed or when more info is needed.

### 10. Mobile First-Session Flow

Mobile should use one active surface at a time, not stacked desktop. Recommended V1:

- Bottom navigation: Chat, Profile, Jobs, Apps, Library.
- Chat docked/full-screen behavior.
- No overlap between chat input and content.
- First session defaults to Chat with a visible path to Profile once Pramania has learned something.

## Persona Findings

### Recent Graduate / Marketing Analyst

This user needs reassurance that thin experience is still usable. The app should not lead with zero metrics or senior-sounding expectations. The strongest path is to translate class projects, internships, part-time customer work, club leadership, and tools into entry-level marketing analyst, coordinator, CRM, email, social, growth, or research positioning.

High-value fixes:

- Entry-level onboarding path.
- "You are not starting from zero" copy.
- Role suggestions for attainable first jobs.
- Prompts that ask for project size, audience, tools, campaign goals, and part-time responsibility.

### Backend / Software Engineer

This user needs evidence extraction from resume, GitHub, portfolio, and project links. Pramania should identify senior backend, platform, distributed systems, API, data infrastructure, or tech-lead lanes from project evidence.

High-value fixes:

- Treat GitHub and technical portfolios as first-class sources.
- Show architecture, systems, scale, reliability, migration, and ownership evidence.
- Make uploaded work history appear in chronological resume immediately.

### Senior GTM / RevOps Leader

This user wants strategic lane clarity and strong executive-commercial metrics. Pramania can add value if it gives a confident point of view on primary lane, secondary lane, avoid lane, evidence gaps, and job-fit tradeoffs.

High-value fixes:

- Lane strategy panel.
- GTM/RevOps metric checklist.
- Stronger job-fit explanation beyond keyword match.
- Explicit proof of what changed after upload.

### Career Changer / Teacher to Customer Success or Enablement

This user needs translation, not judgment. Pramania should say which roles are plausible, why, what proof is missing, and how existing experience maps to customer success, enablement, onboarding, implementation, or customer education.

High-value fixes:

- Transferable-skills bridge.
- "What this means in hiring language" responses.
- Prompts for adoption, training outcomes, stakeholder coaching, documentation, facilitation, and time-to-proficiency.

### Healthcare / Clinical Operations Manager

This user is privacy-sensitive and domain-specific. Pramania must clearly warn not to upload unauthorized PHI, explain AI processing/storage/deletion, and prompt for healthcare operations outcomes.

High-value fixes:

- Healthcare-sensitive upload guidance.
- Metrics around patient access, throughput, quality, compliance, staffing, EHR, utilization, and revenue cycle.
- Stronger source provenance for recommendations.

### Executive VP / Board Advisory

This user expects sharper, board-ready interpretation. Generic advice will not pass. Pramania must show executive-level understanding of mandate, scope, governance, commercial impact, stakeholder complexity, and strategic operating model.

High-value fixes:

- Executive first-read format.
- Board/advisory positioning.
- Mandate/scope/scale prompts.
- Executive-caliber resume language with clean chronology.

### International UAE/India Mobile-First Candidate

This user needs geographic and resume-norm guidance. They may have language skills, visa constraints, local-market preferences, and uncertainty about whether to use a CV, resume, US-style, UK-style, or UAE-style format.

High-value fixes:

- Capture target geography, work authorization, language skills, and relocation constraints.
- Explain regional resume norms.
- Support confidence-building English without patronizing tone.

### Product / UX Designer

This user needs portfolio evidence translated into ATS-safe language without flattening voice. Pramania should understand case studies, screenshots, PDF portfolios, design systems, product outcomes, research, usability, conversion, launch impact, and stakeholder influence.

High-value fixes:

- Portfolio URL/PDF/screenshot intake.
- Side-by-side evidence to bullet transformation.
- Designer-specific role and seniority prompts.
- Preserve tone while making resume ATS-safe.

### Logistics / Operations Supervisor

This user may not have a resume or LinkedIn. The product must work from rough speech or plain notes and gently extract value. It should not feel like a white-collar-only tool.

High-value fixes:

- "I do not have a resume" path.
- Voice/rough-note intake.
- Certificate photo support.
- Plain-language to resume-language examples.
- Practical metric prompts with ranges.

### Returning User

This user needs orientation and continuity. They should immediately know what changed, what is active, what needs follow-up, where files are, what credits remain, and whether support issues are resolved.

High-value fixes:

- Since-last-visit panel.
- Active application follow-up list.
- Library with uploaded/generated tabs.
- Credit and purchase history.
- Support status.
- Chat context summary with deep links.

## Launch Recommendation

Pramania is directionally strong and emotionally differentiated, but public launch should wait until these conditions are met:

1. Uploading a resume or LinkedIn PDF reliably produces a visible, accurate profile and chronological master resume.
2. Pramania can answer context questions without asking users to repeat themselves.
3. Jobs and Applications are compact enough for 10+ records.
4. Credit usage is transparent and linked from Settings/Pricing.
5. Support issues can be logged and tracked.
6. Mobile first-session is one-surface-at-a-time.
7. The chat never claims a completed action unless the workspace state confirms it.

Once those are complete, Pramania should be suitable for a controlled public beta with close owner monitoring, not a broad paid launch without guardrails.

## Recommended Next Workstream

1. Build the first-upload proof moment.
2. Fix master resume chronology, optional sections, duplicate suppression, and export validation.
3. Harden chat context orchestration and action receipts.
4. Convert Jobs, Applications, and Library to compact scan-first records.
5. Tighten mobile first-session navigation.
6. Add credit transparency, purchase history, and support issue loop.
7. Add domain-specific prompt packs for the six highest-priority personas: early career, GTM/RevOps, engineering, healthcare ops, logistics ops, and design.
