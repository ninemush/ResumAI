import { brand } from "@/lib/brand";

const careerScopeTerms = [
  "achievement",
  "application",
  "applied",
  "apply",
  "award",
  "career",
  "certification",
  "cover letter",
  "credential",
  "cv",
  "education",
  "employer",
  "experience",
  "goal",
  "hire",
  "hiring",
  "interview",
  "job",
  "linkedin",
  "manager",
  "portfolio",
  "profile",
  "project",
  "promotion",
  "recruiter",
  "resume",
  "role",
  "salary",
  "skill",
  "strength",
  "team",
  "title",
  "work",
];

const offPurposeTerms = [
  "astrology",
  "celebrity",
  "crypto",
  "date night",
  "football",
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

export type ProfileIntakeScopeCheck = {
  capabilityAnswer?: string;
  inScope: boolean;
  redirectMessage?: string;
};

export function checkProfileIntakeScope(message: string): ProfileIntakeScopeCheck {
  const normalizedMessage = normalize(message);

  if (isCapabilityQuestion(normalizedMessage)) {
    return {
      inScope: false,
      capabilityAnswer: buildCapabilityAnswer(),
    };
  }

  if (hasAnyTerm(normalizedMessage, careerScopeTerms)) {
    return { inScope: true };
  }

  if (
    hasAnyTerm(normalizedMessage, offPurposeTerms) ||
    generalQuestionStarts.some((phrase) => normalizedMessage.startsWith(phrase))
  ) {
    return {
      inScope: false,
      redirectMessage: buildRedirectMessage(),
    };
  }

  return { inScope: true };
}

function buildRedirectMessage() {
  return `I can help with your career profile, resume, role fit, job posts, applications, and interview direction. I cannot really branch into general chat here, but share anything about your work history, strengths, goals, credentials, or a job you are considering and I will help shape it.`;
}

function buildCapabilityAnswer() {
  return `I can help you build a strong career profile, understand what roles may fit you, tailor resumes and cover letters, read job posts, compare them against your background, and keep track of applications. You can start naturally: tell me about your work history, drop a resume, paste your LinkedIn or portfolio link, or share a job post you are considering.`;
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

function hasAnyTerm(message: string, terms: string[]) {
  return terms.some((term) => message.includes(term));
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(new RegExp(brand.name.toLowerCase(), "g"), "")
    .replace(/\s+/g, " ")
    .trim();
}
