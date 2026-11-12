"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ErrorAnnouncer } from "@/client/components/auth/error-announcer";
import { FormMessage } from "@/client/components/auth/form-message";
import { SubmitButton } from "@/client/components/auth/submit-button";
import { TextField } from "@/client/components/auth/text-field";
import { useAuthForm } from "@/client/components/auth/use-auth-form";
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
import type { FormAction, FormState } from "@/shared/form-state";

type ConfirmSheetProps = {
  action: FormAction;
  /** Hidden inputs sent with the form (the group, and who the action is about). */
  fields: Record<string, string>;
  opener: {
    label: ReactNode;
    /** The opener's accessible name, when it needs to say more than its label (which person). */
    ariaLabel?: string;
    variant?: "outline" | "destructive";
    className?: string;
    disabled?: boolean;
  };
  /** Return false to keep the sheet shut (for example nothing is picked yet). */
  canOpen?: () => boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  confirmVariant?: "default" | "destructive";
  /** The confirm button stays disabled until this text is typed exactly; the server checks again. */
  typeToConfirm?: { name: string; label: string; expected: string };
};

/**
 * A button that opens a confirm sheet over the page: title, what will happen, Cancel and the
 * confirming button. The form lives inside the sheet's content, which is gone when the sheet is
 * shut, so every opening starts clean: no typed text, no old error. The sheet is also shut when
 * Next hides the page (Activity), so nothing waits open on a page the person left.
 */
export function ConfirmSheet({ opener, canOpen, title, description, action, ...form }: ConfirmSheetProps) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);

  // A finished action shuts the sheet, so no confirm can outlive the thing it was about.
  const closeWhenDone = useCallback(
    async (previous: FormState, data: FormData) => {
      const next = await action(previous, data);
      if (next.status === "done") setOpen(false);
      return next;
    },
    [action],
  );

  useLayoutEffect(() => () => setOpen(false), []);

  return (
    <>
      <Button
        ref={openerRef}
        type="button"
        variant={opener.variant ?? "outline"}
        aria-label={opener.ariaLabel}
        disabled={opener.disabled}
        className={opener.className ?? "h-11 self-start px-5 text-base"}
        onClick={() => {
          if (!canOpen || canOpen()) setOpen(true);
        }}
      >
        {opener.label}
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
            <SheetTitle className="text-lg font-semibold [overflow-wrap:anywhere]">{title}</SheetTitle>
            <SheetDescription className="text-base [overflow-wrap:anywhere]">{description}</SheetDescription>
          </SheetHeader>
          <ConfirmForm action={closeWhenDone} {...form} />
        </SheetContent>
      </Sheet>
    </>
  );
}

function ConfirmForm({
  action,
  fields,
  confirmLabel,
  pendingLabel,
  confirmVariant = "default",
  typeToConfirm,
}: Pick<ConfirmSheetProps, "action" | "fields" | "confirmLabel" | "pendingLabel" | "confirmVariant" | "typeToConfirm">) {
  const { state, formAction, pending, formRef, announcerRef, onSubmit } = useAuthForm(action);
  const [typed, setTyped] = useState("");
  // Unique in the document: Next keeps pages the person left, so another copy can be in the DOM.
  const uid = useId();
  const errors = state.fieldErrors ?? {};
  const typedError = typeToConfirm ? errors[typeToConfirm.name] : undefined;
  const otherError =
    state.formError ?? Object.entries(errors).find(([name]) => name !== typeToConfirm?.name)?.[1];

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="contents">
      <ErrorAnnouncer announcerRef={announcerRef} />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {otherError ? <FormMessage tone="error" title={otherError} className="mx-4" /> : null}
      {typeToConfirm ? (
        <div className="px-4">
          <TextField
            label={typeToConfirm.label}
            name={typeToConfirm.name}
            id={`${uid}-confirm`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            error={typedError}
          />
        </div>
      ) : null}
      <SheetFooter className="mt-0 pt-0 sm:flex-row-reverse">
        <SubmitButton
          pending={pending}
          pendingLabel={pendingLabel}
          disabled={typeToConfirm !== undefined && typed !== typeToConfirm.expected}
          variant={confirmVariant}
          className="h-auto min-h-11 py-2 whitespace-normal [overflow-wrap:anywhere] sm:w-auto sm:px-5"
        >
          {confirmLabel}
        </SubmitButton>
        <SheetClose asChild>
          <Button type="button" variant="outline" className="h-11 w-full text-base sm:w-auto sm:px-5">
            Cancel
          </Button>
        </SheetClose>
      </SheetFooter>
    </form>
  );
}
