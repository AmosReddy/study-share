import type { ReactNode } from "react";
import { AccountMenu } from "@/client/components/auth/account-menu";
import { AppShell } from "@/client/components/app-shell/app-shell";
import type { AuthUser } from "@/server/ports/auth-provider";
import { loadShellGroups } from "@/server/groups/shell-groups";
import { logOutAction } from "../(auth)/actions";

type SignedInFrameProps = {
  /** The signed-in person who has accepted the terms (from requireAcceptedTerms). */
  user: AuthUser;
  activeGroupId?: string;
  children: ReactNode;
};

/**
 * Every signed-in page's frame: the app shell with the person's real groups and the account
 * menu. It reads the group store, so render it inside the page's Suspense boundary.
 */
export async function SignedInFrame({ user, activeGroupId, children }: SignedInFrameProps) {
  const groups = await loadShellGroups(user);
  return (
    <AppShell
      groups={groups}
      activeGroupId={activeGroupId}
      accountMenu={<AccountMenu name={user.displayName} email={user.email} logOutAction={logOutAction} />}
    >
      {children}
    </AppShell>
  );
}
