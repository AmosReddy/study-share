"use client";

import type { FormAction } from "@/shared/form-state";
import { ConfirmSheet } from "@/client/components/groups/confirm-sheet";

/**
 * "Delete file…" with a confirm sheet. A success goes back to the library (the action redirects).
 * `byOwner` words it for the owner removing someone else's file.
 */
export function DeleteFile({
  groupId,
  fileId,
  title,
  byOwner,
  action,
}: {
  groupId: string;
  fileId: string;
  title: string;
  byOwner: boolean;
  action: FormAction;
}) {
  return (
    <ConfirmSheet
      action={action}
      fields={{ groupId, fileId }}
      opener={{ label: "Delete file…", variant: "destructive" }}
      title={`Delete ${title}?`}
      description={
        byOwner
          ? "As the owner you can delete anyone's file. It disappears for everyone in the group and cannot be brought back."
          : "It disappears for everyone in the group and cannot be brought back."
      }
      confirmLabel={`Yes, delete ${title}`}
      pendingLabel="Deleting…"
      confirmVariant="destructive"
    />
  );
}
