"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AuthCard } from "@/client/components/auth/auth-card";
import { ErrorAnnouncer } from "@/client/components/auth/error-announcer";
import { FormMessage } from "@/client/components/auth/form-message";
import { SubmitButton } from "@/client/components/auth/submit-button";
import { describedBy, FieldError, FieldHint, inputClassName, TextField } from "@/client/components/auth/text-field";
import { useAuthForm } from "@/client/components/auth/use-auth-form";
import { Button } from "@/client/components/ui/button";
import { cn } from "@/client/lib/utils";
import type { FormAction, FormState } from "@/shared/form-state";
import { GROUP_LIMITS, type JoinMode } from "@/shared/groups";
import { CopyButton } from "./copy-button";
import { InviteCard } from "./invite-card";

type CreateGroupScreenProps = { action: FormAction };

/**
 * The Create a group page: the form, then the created screen with the invite.
 *
 * The password chosen in password mode comes back once, in the action's answer, and lives only in
 * this component's state. Next keeps a page's state when the person navigates away (Activity), so
 * as soon as the created screen is hidden the whole form is started over: coming back (Back
 * button or a link) shows an empty form and never the password again.
 */
export function CreateGroupScreen({ action }: CreateGroupScreenProps) {
  const [round, setRound] = useState(0);
  const created = useRef(false);

  useLayoutEffect(
    () => () => {
      if (!created.current) return;
      created.current = false;
      setRound((value) => value + 1);
    },
    [],
  );

  return (
    <CreateGroupForm
      key={round}
      action={action}
      onCreated={() => {
        created.current = true;
      }}
      onStartOver={() => {
        created.current = false;
        setRound((value) => value + 1);
      }}
    />
  );
}

type CreateGroupFormProps = {
  action: FormAction;
  onCreated: () => void;
  onStartOver: () => void;
};

function CreateGroupForm({ action, onCreated, onStartOver }: CreateGroupFormProps) {
  const { state, formAction, pending, formRef, announcerRef, onSubmit } = useAuthForm(action);
  const [mode, setMode] = useState<JoinMode>(state.values?.joinMode === "link" ? "link" : "password");
  const done = state.status === "done" && state.values?.groupId;

  useLayoutEffect(() => {
    if (done) onCreated();
  }, [done, onCreated]);

  if (done) return <CreatedScreen state={state} onStartOver={onStartOver} />;

  const values = state.values ?? {};
  const errors = state.fieldErrors ?? {};

  return (
    <AuthCard title="Create a group" description="A class or a study circle, with its own library of notes and papers.">
      <form ref={formRef} action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <ErrorAnnouncer announcerRef={announcerRef} />
        {state.formError ? <FormMessage tone="error" title={state.formError} /> : null}
        <TextField
          label="Group name"
          name="name"
          autoComplete="off"
          hint="For example, CSE 2nd Year or Maths Circle."
          defaultValue={values.name}
          error={errors.name}
        />
        <DescriptionField defaultValue={values.description} error={errors.description} />
        <JoinModeChoice mode={mode} onChange={setMode} error={errors.joinMode} />
        {mode === "password" ? (
          <TextField
            label="Group password"
            name="password"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            hint={`Send it separately from the link. ${GROUP_LIMITS.passwordMin} to ${GROUP_LIMITS.passwordMax} characters.`}
            error={errors.password}
          />
        ) : null}
        <SubmitButton pending={pending} pendingLabel="Creating…">
          Create group
        </SubmitButton>
      </form>
    </AuthCard>
  );
}

/**
 * The optional description. `id` must be unique in the document: Next keeps pages the person
 * left (Activity), so another page's form with the same ids can still be in the DOM.
 */
export function DescriptionField({ id = "description", defaultValue, error }: { id?: string; defaultValue?: string; error?: string }) {
  const hint = `What the group is for. Up to ${GROUP_LIMITS.descriptionMax} characters.`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        Description (optional)
      </label>
      <textarea
        id={id}
        name="description"
        rows={3}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(inputClassName, "h-auto min-h-24 py-2.5")}
      />
      <FieldHint id={`${id}-hint`}>{hint}</FieldHint>
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}

const MODES: { value: JoinMode; title: string; description: string }[] = [
  {
    value: "password",
    title: "Link and password",
    description: "People need the link or the code, and the password you choose.",
  },
  { value: "link", title: "Link only", description: "Anyone with the link or the code can join." },
];

/** Two radio cards. The whole card is the tap target; the radio keeps a visible focus ring. */
export function JoinModeChoice({
  mode,
  onChange,
  error,
  idPrefix = "joinMode",
}: {
  mode: JoinMode;
  onChange: (mode: JoinMode) => void;
  error?: string;
  /** Unique in the document (see DescriptionField). */
  idPrefix?: string;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={error ? `${idPrefix}-error` : undefined}>
      <legend className="mb-1.5 text-sm font-medium">How people join</legend>
      {MODES.map((option) => {
        const id = `${idPrefix}-${option.value}`;
        return (
          <label
            key={option.value}
            htmlFor={id}
            className="flex min-h-11 cursor-pointer gap-3 rounded-lg border p-3 has-checked:border-foreground has-checked:bg-muted"
          >
            <input
              id={id}
              type="radio"
              name="joinMode"
              value={option.value}
              checked={mode === option.value}
              onChange={() => onChange(option.value)}
              aria-labelledby={`${id}-title`}
              aria-describedby={`${id}-description`}
              className="mt-0.5 size-5 shrink-0 cursor-pointer accent-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span id={`${id}-title`} className="text-base font-medium">
                {option.title}
              </span>
              <span id={`${id}-description`} className="text-sm text-muted-foreground">
                {option.description}
              </span>
            </span>
          </label>
        );
      })}
      {error ? <FieldError id={`${idPrefix}-error`}>{error}</FieldError> : null}
    </fieldset>
  );
}

/** After a successful create: the group, the password once (password mode), and the invite. */
function CreatedScreen({ state, onStartOver }: { state: FormState; onStartOver: () => void }) {
  const values = state.values ?? {};
  const joinMode: JoinMode = values.joinMode === "link" ? "link" : "password";
  const password = state.reveal?.password;
  const heading = useRef<HTMLHeadingElement>(null);

  // The form is gone: take focus to the heading, so screen readers start from the result.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section className="w-full max-w-xl sm:rounded-xl sm:border sm:bg-card sm:p-8 sm:shadow-sm">
      <h1 ref={heading} tabIndex={-1} className="text-3xl leading-tight font-semibold outline-none">
        Group created
      </h1>
      <p className="mt-2 text-lg font-medium [overflow-wrap:anywhere]">{values.name}</p>

      {joinMode === "password" && password ? (
        <div className="mt-7 flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Group password</h2>
          <p className="rounded-lg border bg-muted px-3 py-2.5 font-mono text-base break-all">{password}</p>
          <CopyButton value={password} label="Copy password" />
          <FormMessage tone="info" title="Send the password separately from the link." className="mt-2">
            It is shown only now. Copy it or write it down before you leave this page.
          </FormMessage>
        </div>
      ) : null}

      <div className="mt-8">
        <InviteCard
          inviteUrl={values.inviteUrl ?? ""}
          inviteCode={values.inviteCode ?? ""}
          joinMode={joinMode}
          ownerName={values.ownerName ?? ""}
          groupName={values.name ?? ""}
        />
      </div>

      <div className="mt-8 flex flex-col gap-3 border-t pt-6 sm:flex-row">
        <Button asChild className="h-11 px-5 text-base">
          <Link href={`/groups/${values.groupId}`}>
            Open the group
          </Link>
        </Button>
        <Button type="button" variant="outline" className="h-11 px-5 text-base" onClick={onStartOver}>
          Create another group
        </Button>
      </div>
    </section>
  );
}
