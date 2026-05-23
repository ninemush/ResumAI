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

  if (isModelQuestion(normalizedMessage)) {
    return {
      inScope: false,
      capabilityAnswer: buildModelAnswer(),
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
  return `I need to keep us focused on your career profile, resume, role fit, job posts, applications, and interview direction. Share anything about your work history, target role, achievements, industry, credentials, or a job you are considering and I will help translate it into hiring signal.`;
}

function buildCapabilityAnswer() {
  return `I can help you build a hiring-ready profile, identify roles and seniority levels that fit, sharpen ATS-friendly resume language, read job posts, spot keyword gaps, and turn your experience into clear employer value. You can start naturally: tell me about your work history, drop a resume, paste your LinkedIn or portfolio link, or share a job post you are considering.`;
}

function buildModelAnswer() {
  return `I use an OpenAI language model behind the scenes, but my job here is narrower than a general chatbot: I am tuned for career profile building, recruiter-style screening judgment, ATS-aware resume guidance, role fit, job posts, and application materials. If you share a resume, role, or work-history note, I will review it through that hiring lens.`;
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

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(new RegExp(brand.name.toLowerCase(), "g"), "")
    .replace(/\s+/g, " ")
    .trim();
}
