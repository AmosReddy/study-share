import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { AuthCardSkeleton } from "@/client/components/auth/auth-card";
import { AuthFrame } from "@/client/components/auth/auth-frame";
import { JoinGroupForm } from "@/client/components/groups/join-form";
import { InviteProblem, InviteSignedOut } from "@/client/components/groups/invite-signed-out";
import type { AuthUser } from "@/server/ports/auth-provider";
import { getCurrentUser, requireAcceptedTerms } from "@/server/auth/session";
import { previewDeps } from "@/server/groups/request-deps";
import { previewInvite, type InvitePreview } from "@/server/groups/use-cases";
import { GROUP_MESSAGES, retryHint } from "@/shared/group-messages";
import { startGoogleAction } from "../../(auth)/actions";
import { inAppBrowser, withNext } from "../../(auth)/page-params";
import { SignedInFrame } from "../../_components/signed-in-frame";
import { joinGroupAction } from "../../groups/actions";

/** One title for every invite, so the tab never says whether the key leads to a group. */
export const metadata: Metadata = { title: "Invite | study-share", robots: { index: false, follow: false } };

export default function InvitePage({ params }: PageProps<"/invite/[key]">) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh justify-center px-4 pt-20">
          <AuthCardSkeleton fields={1} />
        </div>
      }
    >
      <Invite params={params} />
    </Suspense>
  );
}

/**
 * The invite link (/invite/<token>) and the code's address (/invite/<code>) alike; previewInvite
 * tells them apart. Signed out: the group's name and the ways in, each of which comes back here.
 * Signed in: the terms first (through /welcome, back here), then a member goes straight to the
 * group and anyone else gets Join, or the message for an invite they cannot use.
 */
async function Invite({ params }: Pick<PageProps<"/invite/[key]">, "params">) {
  const { key } = await params;
  // The key is in the path, never a fragment, so it survives every round trip through `next`.
  const path = `/invite/${encodeURIComponent(key)}`;

  if (!(await getCurrentUser())) {
    const [preview, inApp] = await Promise.all([previewInvite(await previewDeps(), key), inAppBrowser()]);
    return (
      <AuthFrame>
        {preview.state === "open" ? (
          <InviteSignedOut
            groupName={preview.name}
            googleAction={startGoogleAction}
            next={path}
            signupHref={withNext("/signup", path)}
            loginHref={withNext("/login", path)}
            inAppBrowser={inApp}
          />
        ) : (
          <Problem preview={preview} />
        )}
      </AuthFrame>
    );
  }

  const user = await requireAcceptedTerms(path);
  const preview = await previewInvite(await previewDeps(), key);
  if (preview.state === "member") redirect(`/groups/${preview.groupId}`);

  return (
    <SignedIn user={user}>
      {preview.state === "open" ? (
        <section className="w-full max-w-sm sm:rounded-xl sm:border sm:bg-card sm:p-8 sm:shadow-sm">
          <p className="text-muted-foreground">You&apos;re invited to join</p>
          <h1 className="mt-1 text-3xl leading-tight font-semibold [overflow-wrap:anywhere]">{preview.name}</h1>
          {preview.ownerName ? (
            <p className="mt-2 text-muted-foreground [overflow-wrap:anywhere]">Made by {preview.ownerName}</p>
          ) : null}
          <div className="mt-7">
            <JoinGroupForm
              action={joinGroupAction}
              inviteKey={key}
              joinMode={preview.joinMode}
              ownerName={preview.ownerName}
            />
          </div>
        </section>
      ) : (
        <Problem preview={preview} />
      )}
    </SignedIn>
  );
}

function SignedIn({ user, children }: { user: AuthUser; children: ReactNode }) {
  return (
    <SignedInFrame user={user}>
      <div className="flex justify-center pt-2 lg:pt-10">{children}</div>
    </SignedInFrame>
  );
}

/** Every invite that cannot be used. A dead, reset or made-up key all read the same. */
function Problem({ preview }: { preview: Exclude<InvitePreview, { state: "open" }> }) {
  switch (preview.state) {
    case "limited":
      return (
        <InviteProblem title="Please wait a moment" message={GROUP_MESSAGES.tooMany}>
          {retryHint(preview.retryAfterSeconds)}
        </InviteProblem>
      );
    case "removed":
      return <InviteProblem title="You can't join this group" message={GROUP_MESSAGES.cannotJoin} />;
    // "member" never reaches here: only a signed-in person has a membership, and the signed-in
    // branch redirects it. It reads like a dead invite rather than a crash if that ever changed.
    case "member":
    case "invalid":
      return <InviteProblem title="This invite can't be used" message={GROUP_MESSAGES.invalidInvite} />;
  }
}
