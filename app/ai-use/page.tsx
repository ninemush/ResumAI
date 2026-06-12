import Link from "next/link";

import { brand } from "@/lib/brand";
import { aiUseNotices } from "@/lib/privacy/compliance-config";

export default function AiUsePage() {
  return (
    <main className="legal-page">
      <section className="legal-document" aria-labelledby="ai-use-title">
        <Link className="legal-back-link" href="/">
          Back to {brand.name}
        </Link>
        <p className="eyebrow">Transparency</p>
        <h1 id="ai-use-title">AI Use Notice</h1>
        <p className="legal-meta">Draft operational notice. This is not legal advice.</p>

        <p>
          {brand.name} uses AI to assist with profile organization, role-fit
          recommendations, resume drafting, cover letter drafting, and job-fit
          review. AI output is assistive draft content and should be reviewed by
          the user before it is used outside the app.
        </p>

        {aiUseNotices.map((notice) => (
          <section key={notice}>
            <h2>{notice}</h2>
            <p>
              Users can submit a privacy request for AI-assisted processing
              review from the Privacy Center in Settings.
            </p>
          </section>
        ))}

        <h2>Boundaries</h2>
        <p>
          {brand.name} does not auto-apply to jobs, submit applications to
          employers, scan job boards, automate browsers, act on employer sites,
          or make hiring decisions. LinkedIn sign-in is authentication only;
          any LinkedIn URL, pasted profile text, or exported file is
          user-provided evidence. Generated content may be inaccurate or
          incomplete.
        </p>
      </section>
    </main>
  );
}
