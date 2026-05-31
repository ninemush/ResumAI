import { AuthPanel } from "@/components/auth/auth-panel";
import { EmailMfaGate } from "@/components/auth/email-mfa-gate";
import { WorkspaceShell } from "@/components/app-shell/workspace-shell";
import { TermsGate } from "@/components/legal/terms-gate";
import { isEmailMfaVerified, isEmailPasswordProvider } from "@/lib/auth/session-security";
import { getWorkspaceSession } from "@/lib/commands/session";

export default async function Home() {
  const session = await getWorkspaceSession();

  if (!session) {
    return <AuthPanel />;
  }

  if (
    isEmailPasswordProvider(session.user.authProvider) &&
    !(await isEmailMfaVerified({ email: session.user.email, userId: session.user.id }))
  ) {
    return <EmailMfaGate email={session.user.email ?? "your email"} />;
  }

  if (session.legal.requiresTermsAcceptance) {
    return <TermsGate firstName={getFirstName(session.user.fullName)} />;
  }

  return <WorkspaceShell session={session} />;
}

function getFirstName(fullName: string | null) {
  return fullName?.trim().split(/\s+/)[0] ?? null;
}
