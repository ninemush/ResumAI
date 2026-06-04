import Link from "next/link";

import { brand } from "@/lib/brand";
import { TERMS_EFFECTIVE_DATE, TERMS_VERSION } from "@/lib/legal/terms";

export default function TermsPage() {
  return (
    <main className="legal-page">
      <section className="legal-document" aria-labelledby="terms-title">
        <Link className="legal-back-link" href="/">
          Back to {brand.name}
        </Link>
        <p className="eyebrow">Legal</p>
        <h1 id="terms-title">Terms and Conditions</h1>
        <p className="legal-meta">
          Effective {TERMS_EFFECTIVE_DATE}. Version {TERMS_VERSION}.
        </p>

        <p>
          These Terms and Conditions govern your access to and use of {brand.name},
          including the website, workspace, conversational assistant, generated
          content, profile tools, resume tools, job-post analysis, application
          tracking, and related services.
        </p>

        <h2>1. Acceptance of Terms</h2>
        <p>
          By creating an account, signing in with a third-party provider, or using
          {brand.name}, you confirm that you have read, understood, and agree to these
          Terms. If you do not agree, do not use the service.
        </p>

        <h2>2. User Responsibility</h2>
        <p>
          You are solely responsible for the information you provide, the materials
          you generate, the decisions you make, the applications you submit, and
          any action you take based on {brand.name}&apos;s output. You must review,
          edit, verify, and approve all resumes, cover letters, profile summaries,
          job-fit analysis, recommendations, and other content before relying on
          or submitting them.
        </p>

        <h2>3. No Employment, Hiring, or Outcome Guarantee</h2>
        <p>
          {brand.name} does not guarantee interviews, job offers, employment,
          compensation, career advancement, acceptance by applicant tracking
          systems, recruiter responses, employer decisions, or any other outcome.
          Career markets and hiring decisions are controlled by third parties and
          many factors outside {brand.name}&apos;s control.
        </p>

        <h2>4. AI-Generated Content</h2>
        <p>
          {brand.name} uses artificial intelligence and automated processing. AI output
          may be incomplete, inaccurate, outdated, biased, unsuitable, or
          misleading. You must independently verify all generated content,
          including claims, dates, employers, titles, credentials, metrics, legal
          statements, and job requirements. You may not submit false, misleading,
          confidential, unauthorized, or unlawful information.
        </p>

        <h2>5. Not Professional Advice</h2>
        <p>
          {brand.name} provides software-assisted career support. It does not provide
          legal, financial, tax, immigration, mental-health, employment-law,
          compliance, or professional recruiting representation. You should seek
          qualified professional advice where appropriate.
        </p>

        <h2>6. Third-Party Sites and Integrations</h2>
        <p>
          {brand.name} may process links, files, or content from third-party websites
          and services. Third-party sites may change, block access, provide
          incomplete information, or impose their own terms. You are responsible
          for ensuring that you have the right to provide or upload any content
          you submit to {brand.name}.
        </p>

        <h2>7. User Content and License</h2>
        <p>
          You retain ownership of content you provide. You grant {brand.name} a
          limited license to host, process, analyze, transform, store, and display
          your content as needed to provide and improve the service, maintain
          security, enforce limits, support auditability, and comply with law.
        </p>

        <h2>8. Privacy and Data Security</h2>
        <p>
          {brand.name} is designed to protect user data, but no system is perfectly
          secure. You should not upload information you are not authorized to
          share. You are responsible for reviewing what you save, export, or submit
          outside the service. Our{" "}
          <Link href="/privacy" target="_blank">
            Privacy Policy
          </Link>{" "}
          explains how {brand.name} collects, uses, stores, and protects information.
        </p>

        <h2>9. Acceptable Use</h2>
        <p>
          You may not use {brand.name} to break the law, misrepresent your identity or
          qualifications, generate fraudulent application materials, scrape
          restricted services unlawfully, attack or disrupt systems, infringe
          intellectual property, upload malicious content, or violate any
          third-party rights or terms.
        </p>

        <h2>10. Service Availability and Changes</h2>
        <p>
          {brand.name} may be updated, changed, interrupted, suspended, or discontinued
          at any time. Features may be experimental, unavailable, rate-limited, or
          modified without notice.
        </p>

        <h2>11. Disclaimer of Warranties</h2>
        <p>
          {brand.name} is provided &quot;as is&quot; and &quot;as available&quot; without
          warranties of any kind, whether express, implied, statutory, or
          otherwise, including warranties of accuracy, reliability, fitness for a
          particular purpose, merchantability, non-infringement, availability,
          security, or error-free operation.
        </p>

        <h2>12. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, {brand.name} and its owners,
          operators, affiliates, employees, contractors, service providers, and
          partners will not be liable for any indirect, incidental, special,
          consequential, exemplary, punitive, or economic damages, including lost
          income, lost opportunities, lost employment, lost profits, reputational
          harm, data loss, application rejection, employer decisions, or reliance
          on generated content.
        </p>
        <p>
          To the maximum extent permitted by law, your sole remedy for
          dissatisfaction with {brand.name} is to stop using the service.
        </p>

        <h2>13. Indemnity</h2>
        <p>
          You agree to defend, indemnify, and hold harmless {brand.name} and its
          owners, operators, affiliates, employees, contractors, service providers,
          and partners from claims, losses, liabilities, damages, costs, and
          expenses arising from your content, your use of the service, your
          submitted applications, your violation of these Terms, or your violation
          of law or third-party rights.
        </p>

        <h2>14. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time. Continued use of {brand.name}
          after changes become effective means you accept the updated Terms.
        </p>

        <h2>15. Contact</h2>
        <p>
          For questions about these Terms, contact the {brand.name} operator through
          the support channel made available in the product.
        </p>
      </section>
    </main>
  );
}
