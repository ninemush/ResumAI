# UX States

The product must feel warm, airy, calming, and intuitive across states.

## Design Language

Principles:

- Warm, not playful.
- Calm, not sterile.
- Candid, not blunt.
- Guided, not controlling.
- Spacious, not sparse.
- Professional, not corporate-heavy.

Visual direction:

- Warm neutral backgrounds.
- Soft but clear surface separation.
- Restrained accent colors.
- High contrast for readable text.
- Elegant motion only when it clarifies state.
- No dense dashboard clutter in the core conversation flow.

## App Shell States

Desktop layout:

- Left navigation.
- Center profile explorer/editor.
- Right conversational AI.

Mobile adaptation:

- Chat-first.
- Profile/application surfaces as tabs, sheets, or drill-in screens.
- Same command layer and business logic as desktop.

## Required States By Feature

### Auth

- Signed out.
- Loading session.
- Auth error.
- Signed in.

### Profile Build

- Empty profile.
- Ingesting source.
- Extracting facts.
- Needs user confirmation.
- Ready for recommendations.
- Profile ready.
- Extraction failed.

### Conversation

- Idle.
- Thinking.
- Asking a clarifying question.
- Showing recommendation.
- Waiting for acknowledgement.
- Recovering from error.

### Role Recommendations

- Not enough signal.
- Recommendation ready.
- User acknowledged.
- User adjusted direction.

### Resume Generation

- Waiting for profile readiness.
- Generating.
- Generated.
- PDF building.
- PDF ready.
- Generation failed.

### Job Evaluation

- Waiting for job link.
- Validating URL.
- Ingesting job post.
- Comparing fit.
- Fit review ready.
- Job unreadable.
- Unsafe URL blocked.

### Application Logging

- Checking quota.
- Quota available.
- Quota exceeded.
- Creating application.
- Generating artifacts.
- Artifacts ready.
- Partial failure with recoverable retry.

### Admin Tier Configuration

- Loading tiers.
- Editing tier.
- Invalid limit.
- Saving.
- Saved.
- Access denied.

## Tone Rules

When the user is neutral:

- Warm, concise, practical.

When the user is uncertain:

- Offer options and explain tradeoffs simply.

When the user is frustrated:

- Reduce verbosity.
- Acknowledge friction.
- Move directly to the next useful action.

When the user is overconfident about a poor-fit role:

- Be candid and kind.
- Explain match risks.
- Offer a stronger alternative path.

