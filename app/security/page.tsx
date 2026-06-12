import Link from "next/link";

import { brand } from "@/lib/brand";
import { complianceHardeningChecklist } from "@/lib/privacy/compliance-config";

export default function SecurityPage() {
  return (
    <main className="legal-page">
      <section className="legal-document" aria-labelledby="security-title">
        <Link className="legal-back-link" href="/">
          Back to {brand.name}
        </Link>
        <p className="eyebrow">Security overview</p>
        <h1 id="security-title">Security Overview</h1>
        <p className="legal-meta">
          Operational overview for launch readiness. No audit, certification, or legal compliance claim is made.
        </p>

        <p>
          {brand.name} is designed around authenticated access, Supabase Row
          Level Security, private storage buckets, server-side validation,
          production rate limits, SSRF-safe public-link ingestion, and avoidance
          of sensitive profile or resume text in telemetry.
        </p>

        <h2>Current Controls</h2>
        <p>
          User workspace records are scoped by authenticated user id. Admin-only
          records are protected by database policies. Uploaded files and
          generated artifacts use private storage paths. Owner/admin tier
          changes and credit actions are expected to leave audit evidence.
        </p>

        <h2>Incident Response</h2>
        <p>
          Security incidents are tracked in an admin-only incident log.
          Notification deadlines are surfaced for operational review when
          notification may be required, but final notification decisions require
          qualified review.
        </p>
        <p>
          To report a security or account-access concern, contact{" "}
          <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.
        </p>

        <h2>Production Hardening Backlog</h2>
        {complianceHardeningChecklist.map((item) => (
          <p key={item.item}>
            {item.item}: {item.status}.
          </p>
        ))}
      </section>
    </main>
  );
}
