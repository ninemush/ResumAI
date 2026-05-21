import { AuthPanel } from "@/components/auth/auth-panel";
import { WorkspaceShell } from "@/components/app-shell/workspace-shell";
import { getWorkspaceSession } from "@/lib/commands/session";

export default async function Home() {
  const session = await getWorkspaceSession();

  return session ? <WorkspaceShell session={session} /> : <AuthPanel />;
}
