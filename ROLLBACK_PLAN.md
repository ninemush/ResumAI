# Rollback Plan

This document defines rollback expectations before implementation.

## Code Rollback

All production changes must be traceable to Git commits.

Rollback options:

- Revert the offending commit.
- Redeploy the last known good Vercel deployment.
- Disable a feature flag or configuration entry where available.

## Database Rollback

Every migration must include one of:

- A safe down migration.
- A forward-fix plan.
- A documented reason rollback is not safe.

Destructive migrations require explicit approval.

## Configuration Rollback

Tier and quota changes must be configuration/data changes.

Rollback options:

- Restore prior tier values.
- Disable a tier.
- Reassign affected users.
- Create audit event explaining the change.

## AI Prompt Rollback

Prompts must be versioned.

Rollback options:

- Revert to previous prompt version.
- Disable a failing generation route.
- Use fallback copy explaining temporary unavailability.

## Incident Conditions

Trigger rollback or disablement if:

- Cross-user data exposure is suspected.
- RLS or auth behavior is broken.
- AI produces unsafe or fabricated user claims at scale.
- Quota events are duplicated or missing.
- Application artifacts are assigned to the wrong user.
- Secrets are exposed.

## Post-Rollback Requirements

After rollback:

- Record incident/audit event.
- Add regression test.
- Update threat model if needed.
- Document root cause and prevention.

