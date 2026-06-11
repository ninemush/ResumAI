# Product Scope

This document defines the V1 product scope for the application currently branded as Pramania.

## Product Positioning

Pramania is a conversation-first job application assistant that helps a user understand their profile, identify suitable roles, generate ATS-friendly materials, and track application outcomes.

The product name is not a permanent architecture decision. UI, prompts, and docs should use shared brand configuration where code is involved.

The experience should feel like talking with a warm, candid, patient career advisor who has deep job-placement experience and always focuses on the user's best outcome.

The conversational assistant is purpose-bound. It should not behave like a
general chatbot for unrelated topics; off-purpose requests should be politely
redirected back to career profile, resume, role-fit, job-post, application, or
interview work.

## V1 Experience

### 1. Profile Build

Users can build their profile through:

- Natural-language conversation.
- Direct profile explorer/editor updates.
- Optional profile photo upload for formats that support a photo.
- Resume uploads.
- Credential uploads.
- Experience and accolade notes.
- PDF, DOCX, TXT, JPG, PNG, and other common file formats.
- OCR for image-based profile materials.
- Public links to LinkedIn, personal websites, portfolios, and profile pages.

The app should:

- Extract useful profile facts.
- Distinguish user-provided facts from inferred suggestions.
- Ask gentle clarifying questions.
- Avoid an interrogative tone.
- Let the user correct, confirm, or delete profile information.
- Recommend likely role families, role titles, and seniority level.
- Ask for user acknowledgement before using a target direction for final resume generation.

### 2. Master Resume

The app generates an ATS-friendly master resume that:

- Is grounded in confirmed profile facts.
- Does not sound generic or obviously AI-written.
- Preserves a hint of the user's voice and personality.
- Avoids invented facts, dates, credentials, companies, or accomplishments.
- Uses ATS-friendly layout by default.
- Excludes profile photos from ATS-first formats unless the user selects a photo-compatible format.
- Produces PDF and DOCX artifacts from a standard ATS template; PDFs are available only after validation confirms required content is present, readable, and not clipped.

### 3. Job-Specific Application Flow

Users can paste a job post link into the conversation.

The app should:

- Ingest the job posting.
- Extract company, role, requirements, and useful keywords.
- Validate fit against the user's profile.
- Explain match, gaps, and tradeoffs candidly.
- Ask whether the user wants to proceed.

If the user proceeds, the app should:

- Log the application.
- Consume the appropriate tier quota.
- Generate a job-specific ATS-friendly resume.
- Generate a job-specific cover letter.
- Save generated artifacts for download as PDF and DOCX.
- Store company name, job title, posting URL, generated artifact references, and status.

### 4. Application Tracking

Users can update application status:

- No reply.
- Rejected.
- Interview in progress.
- Interviewed, not selected.
- Interviewed, selected.
- Withdrawn.

Application records that consumed quota must retain audit-safe usage evidence.

### 5. Admin Console

Admin is owner-only for V1.

The admin console must allow tier configuration without code changes:

- Create tiers.
- Set application limits.
- Set generation limits if needed.
- Enable or disable tiers.
- View usage and audit-safe quota events.
- Monitor operating metrics: signed-up users, active users, feature usage, profile/resume creation, job applications, application outcomes, support tickets, escalations, and system-health indicators.

Tier changes must be configuration/data changes, not code changes.

### 6. Support

Support is included as an operating foundation.

- L0: self-serve documentation and guided troubleshooting.
- L1: autonomous support agent for platform-support issues only.
- L2: human support for refunds, sensitive matters, legal/privacy/security concerns, unresolved issues, and escalations.

The L1 support agent must be empathetic, expert in the product, able to review support-safe logs and user activity metadata, and able to produce a complete escalation packet when human help is required.

### 7. Credits And Payments

V1 includes one-time credit purchases through the existing RevenueCat/Stripe
checkout configuration.

The app should:

- Show credit balance, usage, purchase history, and receipt/invoice support state.
- Grant purchased credits through webhook events exactly once.
- Ignore unknown product ids without granting credits.
- Let owner/admin trace payment event references to credit ledger rows.
- Support refund/support reconciliation without storing payment methods in the app.

## V1 Layout

Desktop:

- Left navigation bar.
- Center console for profile explorer/editor, source visibility, job review, and artifacts.
- Right conversational AI interface as the primary input surface.
- Users should be able to type, paste profile/job links, and drop files directly into the conversational AI. Avoid separate intake widgets unless there is a clear workflow need.

Mobile:

- Exact layout is not final.
- Recommended posture is chat-first with profile/application panels as tabs, sheets, or drill-in screens.
- Mobile must reuse the same backend, command layer, validation schemas, data model, AI orchestration, and tier logic.

## V1 Non-Goals

V1 must not include:

- Auto-apply.
- Semi-auto apply.
- Job scanning.
- Browser automation.
- Native mobile release.
- Submitting data to employers.
- Authenticated LinkedIn/job-board/company-career-site integrations without separate approval.
- Subscriptions.
- Enterprise invoicing.
- Marketplace billing.
- Stored payment method management.
- Automatic renewals, auto-refills, or recurring charges.

## Future Expected Capabilities

Future versions may include:

- Authenticated LinkedIn integration.
- Job board integrations.
- Company career-site integrations.
- Native mobile app using shared TypeScript/domain logic.
- Deeper analytics and job-search optimization loops.
