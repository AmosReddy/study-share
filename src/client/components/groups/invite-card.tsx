"use client";

import { Share2 } from "lucide-react";
import { useId, useSyncExternalStore } from "react";
import { Button } from "@/client/components/ui/button";
import type { JoinMode } from "@/shared/groups";
import { CopyButton } from "./copy-button";

type InviteCardProps = {
  inviteUrl: string;
  inviteCode: string;
  joinMode: JoinMode;
  ownerName: string;
  groupName: string;
};

/**
 * The message people forward. In password mode it says whom to ask for the password; the
 * password itself is never in it (this card is never given the password).
 */
export function inviteMessage({ inviteUrl, joinMode, ownerName, groupName }: Omit<InviteCardProps, "inviteCode">): string {
  const base = `Join ${groupName} on study-share: ${inviteUrl}`;
  return joinMode === "password" ? `${base}. Ask ${ownerName} for the group password.` : base;
}

const noSubscription = () => () => {};

/** Whether the browser can open its own share sheet. False on the server and before hydration. */
function useCanShare(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => typeof navigator.share === "function",
    () => false,
  );
}

const valueClass = "rounded-lg border bg-muted px-3 py-2.5 font-mono text-base break-all";

/** The invite link and the code, each with a Copy button, and ways to send them on. */
export function InviteCard(props: InviteCardProps) {
  const { inviteUrl, inviteCode } = props;
  const canShare = useCanShare();
  const message = inviteMessage(props);
  // Unique in the document: Next keeps pages the person left, so another copy can be in the DOM.
  const headingId = useId();

  async function share() {
    try {
      await navigator.share({ text: message });
    } catch {
      // Closed without sharing, or the browser refused: nothing to say.
    }
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <h2 id={headingId} className="text-xl font-semibold">
        Invite people
      </h2>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Invite link</p>
        <p data-testid="invite-link" className={valueClass}>
          {inviteUrl}
        </p>
        <CopyButton value={inviteUrl} label="Copy link" />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Group code</p>
        <p className="text-sm text-muted-foreground">People can type this on the Join page instead of opening the link.</p>
        <p data-testid="invite-code" className={`${valueClass} tracking-widest`}>
          {inviteCode}
        </p>
        <CopyButton value={inviteCode} label="Copy code" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button asChild className="h-11 px-5 text-base">
          <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
            Share on WhatsApp
          </a>
        </Button>
        {canShare ? (
          <Button type="button" variant="outline" className="h-11 gap-2 px-5 text-base" onClick={share}>
            <Share2 aria-hidden="true" />
            Share
          </Button>
        ) : null}
      </div>
    </section>
  );
}
