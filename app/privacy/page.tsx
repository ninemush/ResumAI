import Link from "next/link";

import { brand } from "@/lib/brand";
import { PRIVACY_POLICY_EFFECTIVE_DATE, PRIVACY_POLICY_VERSION } from "@/lib/legal/terms";

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <section className="legal-document" aria-labelledby="privacy-title">
        <Link className="legal-back-link" href="/">
          Back to {brand.name}
        </Link>
        <p className="eyebrow">Legal</p>
        <h1 id="privacy-title">Privacy Policy</h1>
        <p className="legal-meta">
          Effective {PRIVACY_POLICY_EFFECTIVE_DATE}. Version {PRIVACY_POLICY_VERSION}.
        </p>

        <p>
          This Privacy Policy explains how {brand.name} collects, uses, stores, and
          protects information when you use the website, workspace, conversational
          assistant, resume tools, job-post analysis, application tracking, and
          related services.
        </p>

        <h2>1. Information You Provide</h2>
        <p>
          We may process information you choose to submit, including your name,
          email address, profile photo, resume, career history, education,
          credentials, accolades, skills, goals, preferences, job links, profile
          links, uploaded files, images, screenshots, notes, chat messages,
          generated resumes, cover letters, application records, status updates,
          and support requests.
        </p>

        <h2>2. Information Created by the Service</h2>
        <p>
          {brand.name} may create derived information such as profile summaries, role
          recommendations, seniority reads, job-fit analysis, generated materials,
          source-extraction status, artifact versions, timestamps, usage counts,
          audit events, error logs, and security signals needed to operate the
          service.
        </p>

        <h2>3. How We Use Information</h2>
        <p>
          We use information to authenticate users, build and maintain career
          profiles, parse sources, generate and export resumes and cover letters,
          compare jobs against profile context, track applications, enforce
          credit and usage limits, maintain audit trails, provide support,
          improve reliability, prevent abuse, debug errors, secure the product,
          and comply with legal obligations.
        </p>

        <h2>4. AI Processing</h2>
        <p>
          {brand.name} uses AI providers to analyze your submitted content and produce
          drafts, recommendations, and structured outputs. We send only the
          information reasonably needed for the requested workflow. AI output can
          be inaccurate or incomplete, so you remain responsible for reviewing and
          approving anything you use outside {brand.name}.
        </p>

        <h2>5. Third-Party Services</h2>
        <p>
          {brand.name} may rely on service providers for hosting, authentication,
          database, file storage, AI processing, analytics, logging, payments,
          email, and support. These providers process information only as needed
          to provide their services to {brand.name} and are expected to protect it
          under their own security and privacy commitments.
        </p>

        <h2>6. Public Links and Uploaded Sources</h2>
        <p>
          If you provide a public profile, portfolio, job posting, or website
          link, {brand.name} may attempt to read publicly available content from that
          link. Some sites block automated access or require sign-in. You are
          responsible for ensuring you have the right to submit any link, file, or
          content you provide.
        </p>
        <p>
          LinkedIn sign-in is used only for authentication in V1. Public LinkedIn
          URLs, pasted profile text, or exported profile files are treated as
          user-provided evidence. {brand.name} does not offer authenticated
          LinkedIn import in V1.
        </p>

        <h2>7. Data Separation and Access Control</h2>
        <p>
          User workspace data is scoped to authenticated accounts. {brand.name} is
          designed to enforce data separation through server-side validation,
          database access controls, and storage rules. Administrative access is
          limited to operating, securing, supporting, and improving the service.
        </p>

        <h2>8. Retention</h2>
        <p>
          We keep account, profile, source, chat, artifact, and application data
          while your account is active or as needed to provide the service.
          Certain application, quota, billing, security, and audit records may be
          retained for longer where needed to enforce limits, resolve disputes,
          prevent abuse, satisfy legal obligations, or maintain business records.
        </p>

        <h2>9. Your Choices</h2>
        <p>
          You can choose what to upload, paste, save, edit, export, or submit
          outside {brand.name}. {brand.name} prepares and tracks materials; you decide
          where and when to submit them. You may request access, correction, deletion, or export
          of your personal information through the support channel made available
          in the product. Some audit-minimum records may be retained where legally
          or operationally required.
        </p>

        <h2>10. Security</h2>
        <p>
          {brand.name} uses technical and organizational safeguards designed to protect
          information against unauthorized access, loss, misuse, alteration, and
          disclosure. No internet service is perfectly secure, and you should not
          upload information you are not authorized or comfortable sharing.
        </p>

        <h2>11. Cookies and Similar Technologies</h2>
        <p>
          We may use cookies, local storage, or similar technologies for sign-in,
          session management, security, preferences, diagnostics, and product
          functionality. Disabling these technologies may prevent parts of the
          service from working.
        </p>

        <h2>12. International Processing</h2>
        <p>
          Your information may be processed in countries other than where you live.
          Where required, {brand.name} will use appropriate safeguards for transfers
          and processing of personal information.
        </p>

        <h2>13. Children</h2>
        <p>
          {brand.name} is not intended for children or anyone under the age required
          to consent to data processing in their jurisdiction. Do not use the
          service if you are not legally permitted to do so.
        </p>

        <h2>14. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Continued use of
          {brand.name} after changes become effective means the updated policy applies.
        </p>

        <h2>15. Contact</h2>
        <p>
          For privacy questions or requests, contact the {brand.name} operator through
          the support channel made available in the product.
        </p>
      </section>
    </main>
  );
}
