const internalTermPatterns = [
  /\bsaved master resume snapshot\b/gi,
  /\bprofile_facts\b/gi,
  /\bgenerated_resumes\b/gi,
  /\bcontent_json\b/gi,
  /\bdatabase schema\b/gi,
  /\bschema names?\b/gi,
  /\bpipeline mechanics?\b/gi,
  /\bsource extraction pipeline\b/gi,
  /\bProfessional Experience \(\d+ role sections?\)/g,
];

const fakeActionPatterns = [
  /\bI (rebuilt|regenerated|saved|exported|logged|retried|updated|fixed|applied)\b/gi,
  /\bI've (rebuilt|regenerated|saved|exported|logged|retried|updated|fixed|applied)\b/gi,
  /\bI have (rebuilt|regenerated|saved|exported|logged|retried|updated|fixed|applied)\b/gi,
];

export function guardAdvisorMessage(message: string) {
  let guarded = message;

  for (const pattern of internalTermPatterns) {
    guarded = guarded.replace(pattern, "saved workspace context");
  }

  for (const pattern of fakeActionPatterns) {
    guarded = guarded.replace(pattern, "I can help you $1");
  }

  return guarded
    .replace(/\bsaved workspace context \(\d+ role sections?\)/gi, "saved workspace context")
    .replace(/\bI can help you applied\b/gi, "I can help you review the application")
    .replace(/\bI can help you fixed\b/gi, "I can help you review the issue")
    .replace(/\bI can help you saved\b/gi, "I can help you save")
    .replace(/\bI can help you exported\b/gi, "I can help you export")
    .replace(/\bI can help you updated\b/gi, "I can help you update")
    .replace(/\bI can help you rebuilt\b/gi, "I can help you rebuild")
    .replace(/\bI can help you regenerated\b/gi, "I can help you regenerate")
    .replace(/\bI can help you logged\b/gi, "I can help you log")
    .replace(/\bI can help you retried\b/gi, "I can help you retry")
    .trim();
}
