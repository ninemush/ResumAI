import type { ResumeContent } from "@/lib/resumes/resume-content";

const highImpactPatterns = [
  /\bverify\b/i,
  /\bunsupported\b/i,
  /\bbefore export\b/i,
  /\bemployer|company|title|date|credential|education|location\b/i,
  /\bclearance|citizenship|visa|eligible|eligibility|compensation|salary\b/i,
  /\bseniority|director|manager|lead|principal|senior\b/i,
  /\b\d+(?:[%.,]|\b)/,
];

export type ExportRisk = {
  category: "keyword_gap" | "reviewer_note";
  severity: "high" | "medium";
  text: string;
};

export function classifyResumeExportRisks(resume: ResumeContent): ExportRisk[] {
  return [
    ...resume.keywordGaps.map((text) => classifyRisk("keyword_gap", text)),
    ...resume.reviewerNotes.map((text) => classifyRisk("reviewer_note", text)),
  ];
}

export function hasBlockingExportRisks(resume: ResumeContent) {
  return classifyResumeExportRisks(resume).some((risk) => risk.severity === "high");
}

function classifyRisk(category: ExportRisk["category"], text: string): ExportRisk {
  return {
    category,
    severity: highImpactPatterns.some((pattern) => pattern.test(text)) ? "high" : "medium",
    text,
  };
}
