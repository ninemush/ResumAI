import Link from "next/link";

import { brand } from "@/lib/brand";
import { subprocessorConfig } from "@/lib/privacy/compliance-config";

export default function SubprocessorsPage() {
  return (
    <main className="legal-page">
      <section className="legal-document" aria-labelledby="subprocessors-title">
        <Link className="legal-back-link" href="/">
          Back to {brand.name}
        </Link>
        <p className="eyebrow">Privacy controls</p>
        <h1 id="subprocessors-title">Subprocessor List</h1>
        <p className="legal-meta">
          Operational draft. Region, DPA, and transfer-basis details must be finalized before public launch.
        </p>

        <p>
          {brand.name} uses service providers to host the app, store data,
          process AI-assisted requests, and manage approved live purchase
          entitlements. The list below is an operational tracking list, not a
          certification claim or completed legal review.
        </p>

        {subprocessorConfig.map((processor) => (
          <section key={processor.name}>
            <h2>{processor.name}</h2>
            <p>{processor.processingPurpose}</p>
            <p>Data categories: {processor.dataCategories.join(", ")}.</p>
            <p>Hosting region: {processor.hostingRegion}</p>
            <p>DPA status: {processor.dpaStatus}. Transfer basis: {processor.crossBorderTransferBasis}</p>
            <p>Operational status: {processor.status}.</p>
          </section>
        ))}
        <p>
          For privacy or subprocessor questions, contact{" "}
          <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>.
        </p>
      </section>
    </main>
  );
}
