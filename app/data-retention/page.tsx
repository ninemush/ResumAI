import Link from "next/link";

import { brand } from "@/lib/brand";
import { retentionPolicyConfig } from "@/lib/privacy/compliance-config";

export default function DataRetentionPage() {
  return (
    <main className="legal-page">
      <section className="legal-document" aria-labelledby="retention-title">
        <Link className="legal-back-link" href="/">
          Back to {brand.name}
        </Link>
        <p className="eyebrow">Privacy controls</p>
        <h1 id="retention-title">Data Retention Policy</h1>
        <p className="legal-meta">
          Operational draft for launch readiness. Exact periods and legal exceptions still require owner and legal approval.
        </p>

        <p>
          {brand.name} keeps data only as needed to provide the workspace,
          generate user-requested materials, maintain security, resolve support
          or billing disputes, and preserve minimum audit-safe records for
          credits, quota, accounting, and abuse prevention.
        </p>

        {retentionPolicyConfig.map((item) => (
          <section key={item.dataCategory}>
            <h2>{item.dataCategory}</h2>
            <p>{item.retentionRule}</p>
            <p>Status: {item.status}.</p>
          </section>
        ))}

        <h2>Deletion And Minimization</h2>
        <p>
          Deletion requests start as privacy requests in the app. Editable
          profile data, uploaded sources, and non-submitted drafts are candidates
          for deletion when no dependency exists. Application, credit, quota,
          security, payment-entitlement, and audit records may instead be
          minimized or retained where needed for support, accounting, fraud,
          dispute, or legal review.
        </p>
        <p>
          For privacy or data-rights help, contact{" "}
          <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.
        </p>
      </section>
    </main>
  );
}
