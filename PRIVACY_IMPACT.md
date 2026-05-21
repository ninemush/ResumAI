# Privacy Impact

This document records V1 privacy considerations before implementation.

## Personal Data Processed

V1 may process:

- Account identifiers.
- Resume contents.
- Uploaded credentials, images, and profile documents.
- OCR extracted text.
- Public profile and portfolio links provided by the user.
- LinkedIn public profile URLs provided by the user.
- Profile facts, inferred facts, and confirmed facts.
- Role recommendations.
- Job URLs and job descriptions.
- Application records and statuses.
- Generated resumes and cover letters.
- Tier assignments and quota events.

## Purpose

Data is processed only to:

- Build and maintain the user's career profile.
- Recommend role direction and level.
- Generate resumes and cover letters.
- Evaluate job fit.
- Track user-approved applications.
- Enforce tier limits and quota usage.
- Provide audit-safe records for quota/accounting disputes.

## Minimization

The app must not collect:

- Government identifiers unless explicitly required later and separately approved.
- Payment data in V1.
- Employer credentials.
- Third-party account passwords.
- Sensitive categories beyond what the user voluntarily includes in career materials.

## Consent And User Control

Users must be able to:

- Choose what to upload or paste.
- Confirm or reject inferred profile facts.
- Correct profile facts.
- Delete editable profile sources and non-submitted drafts.
- Understand when an application consumes quota.

## Retention

Editable profile data and non-submitted drafts should be deletable by the user.

Application records that consumed quota must retain minimum audit-safe evidence:

- User id.
- Tier/quota event.
- Timestamp.
- Company/job metadata.
- Generated artifact references.
- Status history.

Retention durations must be finalized before public launch.

## Third-Party Integrations

Public links are allowed in V1.

Authenticated LinkedIn, job-board, and company-career-site integrations are future capabilities. They require:

- User authorization.
- Terms-of-service review.
- Provider-specific security design.
- Token storage and revocation plan.
- Data minimization review.

## Regional And Compliance Considerations

Before public launch, document:

- Supabase region.
- Vercel region.
- AI provider processing posture.
- Subprocessors.
- Cross-border transfer posture.
- User deletion/export handling.

