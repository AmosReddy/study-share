"use client";

import { useActionState, useId, useRef, useState } from "react";
import { FormMessage } from "@/client/components/auth/form-message";
import { SubmitButton } from "@/client/components/auth/submit-button";
import { Button } from "@/client/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/client/components/ui/sheet";
import { guardAction } from "@/client/components/auth/guard-action";
import { IDLE, type FormAction } from "@/shared/form-state";

/** One row of the list. No ids or emails: only what the screen shows. */
export type MemberItem = { name: string; isOwner: boolean; isYou: boolean };

type MemberListProps = {
  groupId: string;
  groupName: string;
  members: MemberItem[];
  /** "allowed" shows Leave group; "owner" says why the owner cannot leave; "none" shows neither. */
  leave: "allowed" | "owner" | "none";
  ownerCannotLeave: string;
  leaveAction: FormAction;
};

const badgeClass = "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium";

/** The Members tab: everyone in the group, the owner first, then leaving. */
export function MemberList({ groupId, groupName, members, leave, ownerCannotLeave, leaveAction }: MemberListProps) {
  // Unique in the document: Next keeps pages the person left, so another copy can be in the DOM.
  const headingId = useId();
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        <h2 id={headingId} className="text-xl font-semibold">
          Members <span className="text-base font-normal text-muted-foreground">({members.length})</span>
        </h2>
        <ul aria-label="Members" className="flex flex-col divide-y rounded-xl border">
          {members.map((member, index) => (
            <li key={index} className="flex min-h-14 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <span className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">{member.name}</span>
              <span className="flex shrink-0 gap-2">
                {member.isOwner ? <span className={`${badgeClass} bg-highlight/25`}>Owner</span> : null}
                {member.isYou ? <span className={`${badgeClass} bg-muted`}>You</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {leave === "allowed" ? (
        <LeaveGroup groupId={groupId} groupName={groupName} action={leaveAction} />
      ) : leave === "owner" ? (
        <p className="text-muted-foreground">{ownerCannotLeave}</p>
      ) : null}
    </div>
  );
}

/** Leave group, with a confirm sheet. A success goes home (the action redirects). */
function LeaveGroup({ groupId, groupName, action }: { groupId: string; groupName: string; action: FormAction }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(guardAction(action), IDLE);
  const openerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="flex flex-col gap-3">
      {state.formError && !open ? <FormMessage tone="error" title={state.formError} /> : null}
      <Button
        ref={openerRef}
        type="button"
        variant="destructive"
        className="h-11 self-start px-5 text-base"
        onClick={() => setOpen(true)}
      >
        Leave group
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="mx-auto w-full max-w-lg sm:rounded-t-xl"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            openerRef.current?.focus();
          }}
        >
          <SheetHeader className="pr-14">
            <SheetTitle className="text-lg font-semibold [overflow-wrap:anywhere]">Leave {groupName}?</SheetTitle>
            <SheetDescription className="text-base">
              You will no longer see its library or members. You can join again later with an invite link or code.
            </SheetDescription>
          </SheetHeader>
          <form action={formAction} className="contents">
            <input type="hidden" name="groupId" value={groupId} />
            {state.formError ? <FormMessage tone="error" title={state.formError} className="mx-4" /> : null}
            <SheetFooter className="mt-0 pt-0 sm:flex-row-reverse">
              <SubmitButton pending={pending} pendingLabel="Leaving…" className="sm:w-auto sm:px-5">
                Leave group
              </SubmitButton>
              <SheetClose asChild>
                <Button type="button" variant="outline" className="h-11 w-full text-base sm:w-auto sm:px-5">
                  Cancel
                </Button>
              </SheetClose>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
