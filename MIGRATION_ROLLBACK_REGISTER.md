# Migration Rollback Register

This register classifies every applied Supabase migration with a rollback posture. Destructive rollback is not automatic; production response should prefer forward fixes unless an owner explicitly approves a rollback.

| Migration | Rollback posture |
| --- | --- |
| `20260521130000_initial_secure_foundation.sql` | Irreversible with reason: foundational schema and RLS; forward-fix only. |
| `20260522133000_add_conversation_memory.sql` | Forward-fix plan: disable conversation reads/writes and add corrective migration. |
| `20260523110000_add_quota_event_recorder.sql` | Forward-fix plan: preserve quota audit rows and patch recorder function. |
| `20260523113000_add_application_status_events.sql` | Forward-fix plan: retain status audit trail and patch function/policies. |
| `20260523120000_add_admin_operating_metrics.sql` | Safe down candidate: drop/replace metrics function if defective. |
| `20260524100000_add_profile_photo.sql` | Forward-fix plan: keep private storage metadata and disable photo UI if needed. |
| `20260527100000_add_job_review_status.sql` | Safe down candidate: remove status column only before production data depends on it. |
| `20260528120000_add_docx_artifact_paths.sql` | Forward-fix plan: keep artifact paths; clear invalid paths through repair migration. |
| `20260528193000_add_terms_acceptance.sql` | Irreversible with reason: legal acceptance evidence; forward-fix only. |
| `20260531103000_expand_admin_outcome_metrics.sql` | Safe down candidate: restore prior metrics function. |
| `20260531143000_expand_owner_console_operations.sql` | Forward-fix plan: owner console functions can be replaced without deleting records. |
| `20260531183000_support_issue_workflow.sql` | Forward-fix plan: preserve support history and patch workflow constraints. |
| `20260531233000_add_auth_attempt_lockouts.sql` | Forward-fix plan: disable lockout checks by function replacement if needed. |
| `20260601120000_credit_ledger_and_promo_codes.sql` | Irreversible with reason: financial/credit audit records; forward-fix only. |
| `20260601163000_add_archive_state_to_jobs_and_applications.sql` | Safe down candidate: clear archive UI and ignore columns; avoid dropping with live data. |
| `20260603120000_backfill_historical_credit_usage.sql` | Irreversible with reason: audit backfill; correct through compensating ledger rows. |
| `20260603170000_normalize_credit_balances.sql` | Irreversible with reason: credit balance normalization; use compensating ledger rows. |
| `20260604120000_add_privacy_compliance_layer.sql` | Irreversible with reason: privacy/security evidence; forward-fix only. |
| `20260604133000_add_privacy_export_completion_rpc.sql` | Forward-fix plan: replace RPC while preserving privacy request history. |
| `20260604150000_add_application_follow_up_plan.sql` | Safe down candidate: ignore fields or drop after exporting needed notes. |
| `20260605110000_support_ticket_reopen_lifecycle.sql` | Forward-fix plan: patch lifecycle rules and preserve ticket history. |
| `20260605120000_add_durable_rate_limits.sql` | Safe down candidate: drop/replace rate-limit RPC if Supabase backend is unavailable. |
| `20260605123000_fix_rate_limit_rpc_ambiguity.sql` | Safe down candidate: restore previous RPC only for incident response. |
| `20260605124500_support_resolution_verification.sql` | Forward-fix plan: patch verification constraints and preserve audit state. |
| `20260605170000_harden_auth_lockout_window.sql` | Forward-fix plan: replace lockout function/window if login availability is harmed. |
| `20260605183000_add_credit_operation_idempotency.sql` | Irreversible with reason: credit idempotency evidence; forward-fix only. |
| `20260605184000_add_privacy_deletion_execution.sql` | Irreversible with reason: deletion/minimization evidence; forward-fix only. |
| `20260605185000_add_profile_fact_evidence_status.sql` | Forward-fix plan: patch evidence defaults and reclassify facts with audit notes. |
| `20260611120000_close_resolved_owner_error_noise.sql` | Forward-fix plan: reopen affected error events with corrective metadata if needed. |
| `20260611133000_reliability_payments_canonical_profile.sql` | Irreversible with reason: reliability/payment/profile canonicalization; forward-fix only. |
| `20260611143000_fix_supabase_lint_findings.sql` | Safe down candidate: restore prior function definitions if lint fix regresses behavior. |
| `20260612103000_add_tier_quota_reservations.sql` | Irreversible with reason: quota reservation audit; release/compensate through new rows. |
| `20260612120000_atomic_revenuecat_credit_grants.sql` | Irreversible with reason: payment grant idempotency; compensating ledger only. |
| `20260612133000_launch_gap_closure_controls.sql` | Forward-fix plan: replace affected policies/functions while preserving audit rows. |
| `20260612143000_export_validation_and_review_acknowledgement.sql` | Forward-fix plan: clear invalid export states; do not weaken validation in production. |
| `20260612153000_add_cover_letter_claim_risks.sql` | Forward-fix plan: recalculate claim risks and acknowledgement metadata. |
| `20260612170000_fix_credit_cleanup_reversal_upsert.sql` | Forward-fix plan: patch reversal upsert and preserve reconciliation evidence. |
| `20260613120000_launch_remediation_export_backstops.sql` | Forward-fix plan: drop unique index only with owner approval; keep validated export gate unless incident response requires emergency function replacement. |
