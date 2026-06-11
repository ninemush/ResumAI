import type { JobFitAnalysis } from "@/lib/jobs/job-fit";

export type EvidenceBasedFitAnalysis = {
  recommendation: "apply" | "network_first" | "stretch" | "skip" | "needs_profile";
  confidence: "low" | "medium" | "high";
  mustHaves: string[];
  matchedEvidence: string[];
  missingEvidence: string[];
  seniorityAssessment: string;
  domainAssessment: string;
  likelyScreeningRisk: string;
  resumeAngle: string;
  nextBestAction: string;
};

export function buildEvidenceBasedFitAnalysis(fit: JobFitAnalysis): EvidenceBasedFitAnalysis {
  if (fit.recommendation === "needs_profile" || fit.score === null) {
    return {
      confidence: "low",
      domainAssessment: "There is not enough trusted profile evidence to compare against the role yet.",
      likelyScreeningRisk: "The resume may not show enough evidence for the must-have requirements.",
      matchedEvidence: fit.matchedKeywords,
      missingEvidence: fit.missingKeywords,
      mustHaves: fit.missingKeywords.slice(0, 6),
      nextBestAction: "Add more profile evidence before deciding whether to spend effort on this role.",
      recommendation: "needs_profile",
      resumeAngle: "Build the profile foundation first.",
      seniorityAssessment: fit.senioritySignals.join(", ") || "Seniority signal is unclear.",
    };
  }

  if (fit.recommendation === "strong_match") {
    return {
      confidence: fit.score >= 70 ? "high" : "medium",
      domainAssessment: "The role shares meaningful language with the current profile evidence.",
      likelyScreeningRisk: fit.risks[0] ?? "Main risk is whether the resume makes the matched evidence obvious enough.",
      matchedEvidence: fit.matchedKeywords,
      missingEvidence: fit.missingKeywords,
      mustHaves: fit.missingKeywords.slice(0, 5),
      nextBestAction: "Apply with a focused resume angle and make the strongest matched evidence easy to scan.",
      recommendation: "apply",
      resumeAngle: fit.matchedKeywords.slice(0, 5).join(", ") || "Lead with the most relevant role evidence.",
      seniorityAssessment: fit.senioritySignals.join(", ") || "Seniority appears plausible from the available evidence.",
    };
  }

  if (fit.recommendation === "possible_match") {
    return {
      confidence: "medium",
      domainAssessment: "There is overlap, but the profile evidence does not yet cover enough of the role.",
      likelyScreeningRisk: fit.risks[0] ?? "A recruiter may not see enough direct evidence for several requirements.",
      matchedEvidence: fit.matchedKeywords,
      missingEvidence: fit.missingKeywords,
      mustHaves: fit.missingKeywords.slice(0, 6),
      nextBestAction: "Network first or add proof for the largest missing requirement before applying cold.",
      recommendation: "network_first",
      resumeAngle: fit.matchedKeywords.slice(0, 4).join(", ") || "Use the closest adjacent evidence.",
      seniorityAssessment: fit.senioritySignals.join(", ") || "Seniority needs a closer look.",
    };
  }

  return {
    confidence: "medium",
    domainAssessment: "The current profile evidence has limited overlap with this job post.",
    likelyScreeningRisk: fit.risks[0] ?? "The application may screen out unless stronger evidence is added.",
    matchedEvidence: fit.matchedKeywords,
    missingEvidence: fit.missingKeywords,
    mustHaves: fit.missingKeywords.slice(0, 8),
    nextBestAction: "Treat this as a stretch or skip it unless there is missing experience you can add.",
    recommendation: fit.score >= 20 ? "stretch" : "skip",
    resumeAngle: fit.matchedKeywords.slice(0, 3).join(", ") || "No strong angle found yet.",
    seniorityAssessment: fit.senioritySignals.join(", ") || "Seniority evidence is weak for this role.",
  };
}
