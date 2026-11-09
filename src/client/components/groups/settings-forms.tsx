"use client";

import { useActionState, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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
import { guardAction } from "@/client/components/auth/guard-action";
import { IDLE, type FormAction, type FormState } from "@/shared/form-state";
import { GROUP_LIMITS, type JoinMode } from "@/shared/groups";
import { CopyButton } from "./copy-button";
import { DescriptionField, JoinModeChoice } from "./create-group-form";
import { InviteCard } from "./invite-card";

type GroupSettingsProps = {
  group: { id: string; name: string; description: string; joinMode: JoinMode };
  invite: { url: string; code: string };
  ownerName: string;
  detailsAction: FormAction;
  joinAction: FormAction;
  resetAction: FormAction;
};

const sectionHeading = "text-xl font-semibold";

/**
 * The owner's Settings tab: the name and description, how people join, the invite link and code,
 * and resetting them. Nothing else yet (email invites, removing people, handing over and deleting
 * come later).
 */
export function GroupSettings({ group, invite, ownerName, detailsAction, joinAction, resetAction }: GroupSettingsProps) {
  // Unique in the document: Next keeps pages the person left, so another copy can be in the DOM.
  const uid = useId();
  const detailsHeading = `${uid}-details-heading`;
  const joinHeading = `${uid}-join-heading`;
  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby={detailsHeading} className="flex flex-col gap-4">
        <h2 id={detailsHeading} className={sectionHeading}>
          Group details
        </h2>
        <DetailsForm groupId={group.id} name={group.name} description={group.description} action={detailsAction} />
      </section>

      <section aria-labelledby={joinHeading} className="flex flex-col gap-4">
        <h2 id={joinHeading} className={sectionHeading}>
          Join settings
        </h2>
        <JoinSettings groupId={group.id} joinMode={group.joinMode} action={joinAction} />
      </section>

      <InviteCard
        inviteUrl={invite.url}
        inviteCode={invite.code}
        joinMode={group.joinMode}
        ownerName={ownerName}
        groupName={group.name}
      />

      <ResetInvite groupId={group.id} action={resetAction} />
    </div>
  );
}

function DetailsForm({ groupId, name, description, action }: { groupId: string; name: string; description: string; action: FormAction }) {
  const { state, formAction, pending, formRef, announcerRef, onSubmit } = useAuthForm(action);
  const values = state.values ?? {};
  const errors = state.fieldErrors ?? {};
  const uid = useId();

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <ErrorAnnouncer announcerRef={announcerRef} />
      <input type="hidden" name="groupId" value={groupId} />
      {state.formError ? <FormMessage tone="error" title={state.formError} /> : null}
      {state.status === "done" && state.notice ? <FormMessage tone="success" title={state.notice} /> : null}
      <TextField
        label="Group name"
        name="name"
        id={`${uid}-name`}
        autoComplete="off"
        defaultValue={values.name ?? name}
        error={errors.name}
        hint={`${GROUP_LIMITS.nameMin} to ${GROUP_LIMITS.nameMax} characters.`}
      />
      <DescriptionField id={`${uid}-description`} defaultValue={values.description ?? description} error={errors.description} />
      <SubmitButton pending={pending} pendingLabel="Saving…" className="sm:w-auto sm:self-start sm:px-5">
        Save details
      </SubmitButton>
    </form>
  );
}

type JoinSettingsProps = { groupId: string; joinMode: JoinMode; action: FormAction };

/**
 * How people join. A new password comes back once, in the action's answer, and lives only in
 * this component's state. Next keeps a page's state when the person moves to another tab or page
 * (Activity), so as soon as this is hidden after a password was shown, the form starts over:
 * coming back shows the form again and never the password.
 */
function JoinSettings({ groupId, joinMode, action }: JoinSettingsProps) {
  const [round, setRound] = useState(0);
  const revealed = useRef(false);

  useLayoutEffect(
    () => () => {
      if (!revealed.current) return;
      revealed.current = false;
      setRound((value) => value + 1);
    },
    [],
  );

  // A page restored from the browser's back-forward cache keeps its state and never runs the
  // effect above: clear the revealed password when the page goes into the cache.
  useEffect(() => {
    function onPageHide(event: PageTransitionEvent) {
      if (!event.persisted || !revealed.current) return;
      revealed.current = false;
      setRound((value) => value + 1);
    }
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  return (
    <JoinSettingsForm
      key={round}
      groupId={groupId}
      joinMode={joinMode}
      action={action}
      onRevealed={() => {
        revealed.current = true;
      }}
      onDone={() => {
        revealed.current = false;
        setRound((value) => value + 1);
      }}
    />
  );
}

function JoinSettingsForm({
  groupId,
  joinMode,
  action,
  onRevealed,
  onDone,
}: JoinSettingsProps & { onRevealed: () => void; onDone: () => void }) {
  const { state, formAction, pending, formRef, announcerRef, onSubmit } = useAuthForm(action);
  const [mode, setMode] = useState<JoinMode>(joinMode);
  const uid = useId();
  const password = state.status === "done" ? state.reveal?.password : undefined;

  useLayoutEffect(() => {
    if (password) onRevealed();
  }, [password, onRevealed]);

  if (password) return <NewPassword password={password} onDone={onDone} />;

  const errors = state.fieldErrors ?? {};
  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <ErrorAnnouncer announcerRef={announcerRef} />
      <input type="hidden" name="groupId" value={groupId} />
      {state.formError ? <FormMessage tone="error" title={state.formError} /> : null}
      {state.status === "done" && state.values?.joinMode === "link" ? (
        <FormMessage tone="success" title="Saved. Anyone with the link or the code can join." />
      ) : null}
      <JoinModeChoice idPrefix={`${uid}-joinMode`} mode={mode} onChange={setMode} error={errors.joinMode} />
      {mode === "password" ? (
        <TextField
          label="New group password"
          name="password"
          id={`${uid}-password`}
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          hint={`People who already joined stay in. ${GROUP_LIMITS.passwordMin} to ${GROUP_LIMITS.passwordMax} characters.`}
          error={errors.password}
        />
      ) : null}
      <SubmitButton pending={pending} pendingLabel="Saving…" className="sm:w-auto sm:self-start sm:px-5">
        Save join settings
      </SubmitButton>
    </form>
  );
}

/** After a password was set: shown once, with Copy, until Done or until the person leaves. */
function NewPassword({ password, onDone }: { password: string; onDone: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);

  // The form is gone: take focus to the heading, so screen readers start from the result.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <h3 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
        Saved. The new group password is
      </h3>
      <p data-testid="revealed-password" className="rounded-lg border bg-muted px-3 py-2.5 font-mono text-base break-all">
        {password}
      </p>
      <CopyButton value={password} label="Copy password" />
      <FormMessage tone="info" title="Send the password separately from the link." className="mt-2">
        It is shown only now. Copy it or write it down before you leave this page.
      </FormMessage>
      <Button type="button" variant="outline" className="h-11 self-start px-5 text-base" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

/** Reset link, with a confirm sheet. On success the page reloads with the new link and code. */
function ResetInvite({ groupId, action }: { groupId: string; action: FormAction }) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const [state, formAction, pending] = useActionState(async (previous: FormState, form: FormData) => {
    const next = await guardAction(action)(previous, form);
    if (next.status === "done") setOpen(false);
    return next;
  }, IDLE);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className={sectionHeading}>
        Reset the invite link
      </h2>
      <p className="text-muted-foreground">
        If the link or the code reached people who should not have it, make new ones. People already in the group stay in.
      </p>
      {state.status === "done" && state.notice ? <FormMessage tone="success" title={state.notice} /> : null}
      {state.formError && !open ? <FormMessage tone="error" title={state.formError} /> : null}
      <Button
        ref={openerRef}
        type="button"
        variant="outline"
        className="h-11 self-start px-5 text-base"
        onClick={() => setOpen(true)}
      >
        Reset link
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
            <SheetTitle className="text-lg font-semibold">Reset the invite link?</SheetTitle>
            <SheetDescription className="text-base">
              The old link and code stop working immediately. People already in the group stay in. Send the new link to
              anyone who still needs to join.
            </SheetDescription>
          </SheetHeader>
          <form action={formAction} className="contents">
            <input type="hidden" name="groupId" value={groupId} />
            {state.formError ? <FormMessage tone="error" title={state.formError} className="mx-4" /> : null}
            <SheetFooter className="mt-0 pt-0 sm:flex-row-reverse">
              <SubmitButton pending={pending} pendingLabel="Resetting…" className="sm:w-auto sm:px-5">
                Reset link
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
    </section>
  );
}
