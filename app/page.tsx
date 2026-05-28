import { AuthPanel } from "@/components/auth/auth-panel";
import { WorkspaceShell } from "@/components/app-shell/workspace-shell";
import { TermsGate } from "@/components/legal/terms-gate";
import { getWorkspaceSession } from "@/lib/commands/session";

export default async function Home() {
  const session = await getWorkspaceSession();

  if (!session) {
    return <AuthPanel />;
  }

  if (session.legal.requiresTermsAcceptance) {
    return <TermsGate firstName={getFirstName(session.user.fullName)} />;
  }

  return <WorkspaceShell session={session} />;
}

function getFirstName(fullName: string | null) {
  return fullName?.trim().split(/\s+/)[0] ?? null;
}
