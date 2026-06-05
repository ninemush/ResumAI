import { brand } from "@/lib/brand";

export const advisorScopeDecisionValues = [
  "in_scope",
  "adjacent_professional",
  "capability_question",
  "model_question",
  "out_of_scope",
] as const;

export type AdvisorScopeDecisionValue = (typeof advisorScopeDecisionValues)[number];

export type AdvisorScopeDecision = {
  decision: AdvisorScopeDecisionValue;
  reason: string;
  redirectMessage: string | null;
};

export function shouldRunFullAdvisor(decision: AdvisorScopeDecision) {
  return decision.decision === "in_scope" || decision.decision === "adjacent_professional";
}

export function buildAdvisorScopeRedirect(decision: AdvisorScopeDecision) {
  const assistantMessage =
    decision.decision === "capability_question"
      ? buildCapabilityAnswer()
      : decision.decision === "model_question"
        ? buildModelAnswer()
        : decision.redirectMessage?.trim() || buildOutOfScopeRedirect();

  return {
    assistantMessage,
    suggestedActions: [],
    suggestedLinks: [
      {
        label: "Review profile",
        reason: "Bring the conversation back to career profile, resume, role fit, and applications.",
        view: "profile" as const,
      },
      {
        label: "Open Library",
        reason: "Use uploaded files and saved career evidence for grounded advice.",
        view: "library" as const,
      },
    ],
  };
}

export function fallbackAdvisorScopeDecision(message: string): AdvisorScopeDecision {
  const normalized = normalizeScopeText(message);

  if (isCapabilityQuestion(normalized)) {
    return {
      decision: "capability_question",
      reason: "The user is asking what the app can do.",
      redirectMessage: null,
    };
  }

  if (isModelQuestion(normalized)) {
    return {
      decision: "model_question",
      reason: "The user is asking about the model or AI system.",
      redirectMessage: null,
    };
  }

  if (hasAnyTerm(normalized, professionalTerms)) {
    return {
      decision: hasAnyTerm(normalized, directCareerTerms) ? "in_scope" : "adjacent_professional",
      reason: "The message is tied to career, work, hiring, applications, or professional communication.",
      redirectMessage: null,
    };
  }

  if (
    hasAnyTerm(normalized, offPurposeTerms) ||
    generalQuestionStarts.some((phrase) => normalized.startsWith(phrase))
  ) {
    return {
      decision: "out_of_scope",
      reason: "The message asks for unrelated general-purpose LLM help.",
      redirectMessage: buildOutOfScopeRedirect(),
    };
  }

  return {
    decision: "in_scope",
    reason: "Ambiguous messages are allowed so the advisor can ask a career-grounding follow-up.",
    redirectMessage: null,
  };
}

export function buildOutOfScopeRedirect() {
  return `I need to keep this workspace focused on career, work, resumes, jobs, applications, and professional communication. I can help turn your experience into a resume bullet, recruiter note, interview answer, role-fit read, or next application step.`;
}

function buildCapabilityAnswer() {
  return `I can help with career profile building, resumes, role fit, job posts, applications, interviews, recruiter communication, professional positioning, and the files you upload here. Share a role, resume, source file, workplace situation, or application question and I will keep it grounded in your saved context.`;
}

function buildModelAnswer() {
  return `I use an OpenAI language model behind the scenes, but this workspace is not a general chatbot. My lane is career and work: profile evidence, resumes, role fit, jobs, applications, interviews, professional communication, and app support.`;
}

function isCapabilityQuestion(message: string) {
  return [
    "what can you help me with",
    "what do you do",
    "how can you help",
    "how do you help",
    "what are you for",
  ].some((phrase) => message.includes(phrase));
}

function isModelQuestion(message: string) {
  return [
    "what llm",
    "which llm",
    "what model",
    "which model",
    "are you using",
    "powered by",
  ].some((phrase) => message.includes(phrase));
}

function hasAnyTerm(message: string, terms: string[]) {
  return terms.some((term) => message.includes(term));
}

function normalizeScopeText(value: string) {
  return value
    .toLowerCase()
    .replace(new RegExp(brand.name.toLowerCase(), "g"), "")
    .replace(/\s+/g, " ")
    .trim();
}

const directCareerTerms = [
  "achievement",
  "application",
  "apply",
  "career",
  "certification",
  "cover letter",
  "cv",
  "education",
  "employer",
  "experience",
  "hire",
  "hiring",
  "interview",
  "job",
  "linkedin",
  "portfolio",
  "profile",
  "project",
  "promotion",
  "recruiter",
  "resume",
  "role",
  "salary",
  "skill",
  "work history",
];

const professionalTerms = [
  ...directCareerTerms,
  "boss",
  "client",
  "colleague",
  "communication",
  "compensation",
  "coworker",
  "email",
  "feedback",
  "leadership",
  "manager",
  "meeting",
  "negotiation",
  "performance",
  "professional",
  "stakeholder",
  "team",
  "work",
  "workplace",
];

const offPurposeTerms = [
  "astrology",
  "celebrity",
  "crypto",
  "date night",
  "fantasy football",
  "game",
  "gossip",
  "horoscope",
  "joke",
  "movie",
  "recipe",
  "sports",
  "stock",
  "vacation",
  "weather",
];

const generalQuestionStarts = [
  "can you explain",
  "can you help me with",
  "do my homework",
  "give me a recipe",
  "how do i code",
  "how do i make",
  "tell me about",
  "what is",
  "what's",
  "who is",
  "write a poem",
];
