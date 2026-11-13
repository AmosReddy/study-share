"use client";

import type { FormAction } from "@/shared/form-state";
import { ConfirmSheet } from "./confirm-sheet";

/**
 * The owner's "Delete group…": a sheet where the group's name must be typed exactly before the
 * confirm button works. The server compares the name again (it may have changed meanwhile).
 */
export function DeleteGroup({ groupId, groupName, action }: { groupId: string; groupName: string; action: FormAction }) {
  return (
    <ConfirmSheet
      action={action}
      fields={{ groupId }}
      opener={{ label: "Delete group…", variant: "destructive" }}
      title={`Delete ${groupName}?`}
      description="Everyone loses access at once. This cannot be undone from the app."
      confirmLabel="Delete this group"
      pendingLabel="Deleting…"
      confirmVariant="destructive"
      typeToConfirm={{ name: "confirmName", label: `Type ${groupName} to confirm`, expected: groupName }}
    />
  );
}
