"use client";

import { useId, useState } from "react";
import { Button } from "@/client/components/ui/button";
import { FieldError } from "@/client/components/auth/text-field";
import type { FormAction } from "@/shared/form-state";
import { GROUP_MESSAGES } from "@/shared/group-messages";
import { ConfirmSheet } from "./confirm-sheet";

/** Another active member, as the owner may pick them. */
export type HandOverCandidate = { userId: string; name: string };

type HandOverProps = { groupId: string; candidates: HandOverCandidate[]; action: FormAction };

/**
 * The owner's "Hand over this group": pick another member, then confirm in a sheet. With nobody
 * else in the group the choice and the button are disabled, and a sentence says why.
 */
export function HandOver({ groupId, candidates, action }: HandOverProps) {
  const uid = useId();
  const [picked, setPicked] = useState("");
  const [missing, setMissing] = useState(false);
  const chosen = candidates.find((candidate) => candidate.userId === picked);
  const errorId = `${uid}-error`;

  if (candidates.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground">Nobody else is in this group yet.</p>
        <Button type="button" variant="outline" disabled className="h-11 self-start px-5 text-base">
          Hand over…
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <fieldset
        className="flex min-w-0 flex-col gap-1"
        aria-describedby={missing ? errorId : undefined}
      >
        <legend className="mb-1 text-sm font-medium">Choose the new owner</legend>
        {candidates.map((candidate) => {
          const id = `${uid}-${candidate.userId}`;
          return (
            <label key={candidate.userId} htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 py-1">
              <input
                id={id}
                type="radio"
                name={`${uid}-new-owner`}
                value={candidate.userId}
                checked={picked === candidate.userId}
                onChange={() => {
                  setPicked(candidate.userId);
                  setMissing(false);
                }}
                className="size-5 shrink-0 cursor-pointer accent-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">{candidate.name}</span>
            </label>
          );
        })}
      </fieldset>
      {missing ? <FieldError id={errorId}>{GROUP_MESSAGES.transferTargetInvalid}</FieldError> : null}
      <ConfirmSheet
        action={action}
        fields={{ groupId, targetUserId: chosen?.userId ?? "" }}
        opener={{ label: "Hand over…" }}
        canOpen={() => {
          if (chosen) return true;
          setMissing(true);
          return false;
        }}
        title={`Make ${chosen?.name ?? "this person"} the owner?`}
        description="You will become a regular member and lose access to Settings."
        confirmLabel={`Make ${chosen?.name ?? "this person"} the owner`}
        pendingLabel="Handing over…"
      />
    </div>
  );
}
