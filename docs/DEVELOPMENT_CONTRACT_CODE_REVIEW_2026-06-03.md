# Development Contract Code Review - 2026-06-03

## Scope

Reviewed the current app against `DEVELOPMENT_CONTRACT.md`, `ARCHITECTURE.md`, and the launch-readiness controls for security, observability, validation, AI boundary behavior, and operational resilience.

## Findings Addressed

### Production MFA Cookie Secret

The MFA/session cookie signer allowed a deterministic local fallback secret even when deployed to production. Production now requires `AUTH_MFA_COOKIE_SECRET` to be configured with at least 32 characters; local fallback is limited to non-production development.

### RevenueCat Webhook Secret

The RevenueCat webhook accepted unsigned events when the webhook secret was not configured. Production now fails closed with a structured configuration error until `REVENUECAT_WEBHOOK_SECRET` is present.

### API Rate Limiting

The contract requires rate limiting on APIs, especially user-facing AI, ingestion, export, authentication, user-data mutation, telemetry, support, and billing-credit surfaces. Added a shared rate-limit guard and applied it to conversation, profile intake, source extraction/download, job ingestion and state changes, application creation/status/archive/materials, resume/material generation, exports, password and MFA auth flows, sign-out, telemetry writes, support issue creation, promo redemption, legal consent, owner promo-code creation, owner credit grants/backfill, and owner issue updates.

The RevenueCat webhook remains the only intentional exception because it is protected by RevenueCat signature verification and fails closed in production when `REVENUECAT_WEBHOOK_SECRET` is missing. App-level client throttling is avoided there so legitimate payment-provider retries are not blocked.

### Operational Data Redaction

Telemetry and support issue creation could persist user-provided text or metadata containing sensitive data. Added a shared redaction layer for secrets, bearer tokens, JWT-like values, emails, phone-like values, and sensitive metadata keys before operational records are stored.

## Validation

- `git diff --check`
- `npm run lint`
- `npm run build`
- `npm run test:e2e`

## Closeout

The contract-audit closeout is complete for the current V1 control baseline. Authentication, credit, telemetry, support, owner, and user-data routes now use structured validation, request IDs, rate limiting, secret-safe operational logging, and fail-closed production configuration where required.

Future scale hardening can move the shared rate limiter from in-memory per-instance state to a managed edge or shared backing store once traffic patterns justify globally consistent distributed throttling. That is a scale optimization rather than an open audit blocker for the current release baseline.
