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
        <p className="legal-meta">Draft operational policy. Final retention periods require legal review.</p>

        <p>
          {brand.name} keeps data only as needed to provide the workspace,
          generate user-requested materials, maintain security, resolve
          disputes, and preserve minimum audit-safe records for credits, quota,
          accounting, and abuse prevention.
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
          Deletion requests start as privacy requests. Some records may be
          deleted, while application, credit, quota, security, and audit records
          may be minimized or retained where needed for operational review.
        </p>
      </section>
    </main>
  );
}
