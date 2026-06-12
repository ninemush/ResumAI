# Privacy and Billing Escalation Procedure

Use this procedure for launch support tickets that involve privacy rights, data deletion/export, billing disputes, credit grants, refunds, duplicate provider events, or reconciliation mismatches.

## Owner Intake

1. Confirm the requester is authenticated or has supplied enough support-safe context to identify the account.
2. Open the owner console and review support metadata, credit ledger entries, provider event IDs, privacy export/deletion records, and recent admin audit rows.
3. Add owner notes before taking action. Notes should include the ticket ID, user ID, reason for access, reviewed evidence, and intended next step.
4. Do not ask the user for secrets, payment card data, provider dashboard passwords, or government identifiers.

## Privacy Requests

1. Classify the request as access/export, correction, deletion, retention objection, or general privacy question.
2. Use the compliance dashboard and privacy request records to verify scope and deadline.
3. For export requests, confirm the export completion record and signed URL delivery state.
4. For deletion requests, confirm retained tables and reasons, especially credit ledger, provider receipts, audit logs, and fraud/dispute evidence.
5. Escalate to the owner if the request involves legal threats, data about another person, deletion of billing evidence, identity uncertainty, or a missed deadline risk.

## Billing And Credits

1. Match the user-visible credit balance to `credit_ledger`, `revenuecat_events`, `credit_reservations`, `credit_operation_outputs`, and `credit_reversals`.
2. For duplicate webhooks or retries, verify provider event IDs and operation keys before granting or reversing credits.
3. For failed paid operations, verify reservation status, ledger event ID, output IDs, export validation status, and whether partial files were cleaned up.
4. Grant credits only through the owner credit grant flow, with a concise reason and user-visible support note.
5. Refund or provider-side payment decisions must be reconciled against RevenueCat/Stripe sandbox or live dashboards before closing the ticket.

## Closure Evidence

Every escalated privacy or billing ticket needs:

- owner note with action taken and evidence reviewed;
- admin access audit row;
- linked provider event ID or privacy request ID when applicable;
- user-visible resolution text;
- reconciliation note when credits, refunds, or retained privacy records are involved.
