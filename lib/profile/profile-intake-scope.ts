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
  inScope: boolean;
  redirectMessage?: string;
};

export function checkProfileIntakeScope(message: string): ProfileIntakeScopeCheck {
  const normalizedMessage = normalize(message);

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
