"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { FormMessage } from "@/client/components/auth/form-message";
import { SubmitButton } from "@/client/components/auth/submit-button";
import { describedBy, FieldError, FieldHint, TextField } from "@/client/components/auth/text-field";
import { putFile } from "@/client/lib/upload-file";
import { cn } from "@/client/lib/utils";
import { AUTH_MESSAGES } from "@/shared/auth-messages";
import { FILE_MESSAGES } from "@/shared/file-messages";
import { OTHER_TYPE_ID, validateAnswers, type FormConfig } from "@/shared/form-config";
import { RESOURCE_LIMITS } from "@/shared/resources";
import { checkChosenFile, titleFromFileName, uploadContentType, UPLOAD_ACCEPT } from "@/shared/upload-checks";
import { DetailInput, OtherTextField, TypeSelect } from "./file-fields";
import { detailInputs, hasUnshownDetailError, typeChoices } from "./form-inputs";

/** What the two upload actions answer (plain data, no storage key). */
type Failure = { ok: false; fieldErrors?: Record<string, string>; formError?: string };
type Answer<T> = { ok: true; data: T } | Failure;

export type PrepareUpload = (
  groupId: string,
  input: unknown,
) => Promise<Answer<{ resourceId: string; uploadUrl: string; headers: Record<string, string> }>>;
export type CompleteUpload = (groupId: string, resourceId: string) => Promise<Answer<{ id: string }>>;

type UploadFormProps = {
  groupId: string;
  /** The group's upload form: the Type select and the extra details are built from it. */
  config: FormConfig;
  /** Values the group already uses for each text detail (detail id to values), offered while typing. */
  suggestions: Record<string, string[]>;
  prepareAction: PrepareUpload;
  completeAction: CompleteUpload;
};

type Phase = "idle" | "preparing" | "uploading" | "checking";

const MAX_MB = RESOURCE_LIMITS.maxFileBytes / (1024 * 1024);

/** Next's redirect() and notFound() throw errors whose digest starts with NEXT_; they are not failures. */
function isNextControlFlow(error: unknown): boolean {
  const digest = typeof error === "object" && error !== null ? (error as { digest?: unknown }).digest : undefined;
  return typeof digest === "string" && digest.startsWith("NEXT_");
}

/**
 * The upload form. Choosing a file fills the title (until the person types their own); the
 * file's kind and size are checked at once with the same rules as the server. Sending is three
 * steps: the server prepares a short-lived link, the browser PUTs the file to it with a progress
 * bar, and the server confirms what arrived. Any failure shows a message and leaves the form as it
 * was; choosing Upload again starts over from step 1, so nothing needs cleaning up by hand.
 *
 * The fields come from the group's form: Title, Type (choosing Other asks what kind of file it is),
 * then the extra details in order. Before anything is sent the answers are checked with the same
 * function the server uses (validateAnswers), for instant feedback; the server still decides, and
 * its errors are shown next to the right field (keys title, type, typeOther, detail:<id>, file).
 */
export function UploadForm({ groupId, config, suggestions, prepareAction, completeAction }: UploadFormProps) {
  const router = useRouter();
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const working = useRef(false);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const titleTouched = useRef(false);
  const types = useMemo(() => typeChoices(config), [config]);
  const specs = useMemo(() => detailInputs(config, {}, suggestions), [config, suggestions]);
  const [typeId, setTypeId] = useState(types[0]?.id ?? OTHER_TYPE_ID);
  const [typeOther, setTypeOther] = useState("");
  const [details, setDetails] = useState<Record<string, string>>(() => Object.fromEntries(specs.map((spec) => [spec.id, ""])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [phase, setPhase] = useState<Phase>("idle");
  const [percent, setPercent] = useState(0);
  // Counts failed attempts, so the first invalid field is focused after each one.
  const [attempt, setAttempt] = useState(0);

  const busy = phase !== "idle";

  useEffect(() => {
    if (attempt === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempt]);

  function fail(nextErrors: Record<string, string>, nextFormError?: string) {
    setErrors(nextErrors);
    setFormError(nextFormError);
    setAttempt((count) => count + 1);
  }

  /** Takes a chosen file into the form: its checks, and a first title while the title is untouched. */
  function takeFile(chosen: File | null) {
    setFile(chosen);
    setFormError(undefined);
    const problem = chosen ? checkChosenFile(chosen) : null;
    setErrors((previous) => {
      const rest = { ...previous };
      delete rest.file;
      return problem ? { ...rest, file: problem } : rest;
    });
    if (!titleTouched.current) setTitle(chosen ? titleFromFileName(chosen.name) : "");
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    takeFile(event.target.files?.[0] ?? null);
  }

  // A file chosen before the page finished loading (or kept by the browser after Back) has no
  // change event for React to see: take whatever the picker holds once the form is ready.
  useEffect(() => {
    const chosen = fileInput.current?.files?.[0];
    if (chosen) takeFile(chosen);
  }, []);

  /** The details to send: what is filled in, for the details the form asks. */
  function answerDetails(): Record<string, string> {
    const entries = specs.map((spec): [string, string] => [spec.id, details[spec.id] ?? ""]);
    return Object.fromEntries(entries.filter(([, value]) => value.trim() !== ""));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working.current) return;

    const found: Record<string, string> = {};
    if (!file) found.file = FILE_MESSAGES.chooseFile;
    else {
      const problem = checkChosenFile(file);
      if (problem) found.file = problem;
    }
    if (title.trim() === "") found.title = FILE_MESSAGES.titleRequired;
    const answers = { typeId, typeOther: typeId === OTHER_TYPE_ID ? typeOther : "", details: answerDetails() };
    const checked = validateAnswers(config, answers);
    if (!checked.ok) Object.assign(found, checked.errors);
    if (!file || Object.keys(found).length > 0) {
      fail(found);
      return;
    }

    working.current = true;
    setErrors({});
    setFormError(undefined);
    setPercent(0);
    setPhase("preparing");
    let leaving = false;
    try {
      const prepared = await prepareAction(groupId, {
        title,
        typeId,
        typeOther: answers.typeOther,
        details: answers.details,
        fileName: file.name,
        contentType: uploadContentType(file.name),
        sizeBytes: file.size,
      });
      if (!prepared.ok) {
        const { fileName, sizeBytes, ...fields } = prepared.fieldErrors ?? {};
        const fileProblem = fileName ?? sizeBytes;
        // A detail the form no longer has (the owner just changed it) has no field to show it next to.
        fail(
          { ...fields, ...(fileProblem ? { file: fileProblem } : {}) },
          prepared.formError ?? (hasUnshownDetailError(fields, specs) ? FILE_MESSAGES.formChanged : undefined),
        );
        return;
      }

      setPhase("uploading");
      const sent = await putFile(file, prepared.data.uploadUrl, prepared.data.headers, setPercent);
      if (!sent.ok) {
        fail({}, FILE_MESSAGES.uploadInterrupted);
        return;
      }

      setPhase("checking");
      // Finishing is safe to repeat. Retrying a dropped connection here keeps a fully sent file from
      // being left behind unfinished (the person would otherwise upload it all again).
      let done = await completeAction(groupId, prepared.data.resourceId).catch((error: unknown) => {
        if (isNextControlFlow(error)) throw error;
        return null;
      });
      for (let attempt = 0; done === null && attempt < 2; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        done = await completeAction(groupId, prepared.data.resourceId).catch((error: unknown) => {
          if (isNextControlFlow(error)) throw error;
          return null;
        });
      }
      if (done === null) {
        fail({}, AUTH_MESSAGES.actionFailed);
        return;
      }
      if (!done.ok) {
        fail({}, done.formError ?? FILE_MESSAGES.couldNotSave);
        return;
      }
      leaving = true;
      router.push(`/groups/${groupId}?notice=uploaded`);
    } catch (error) {
      // A redirect (the session ended) is the router's to follow.
      if (isNextControlFlow(error)) {
        leaving = true;
        return;
      }
      fail({}, AUTH_MESSAGES.actionFailed);
    } finally {
      // After success the form stays locked until the library has opened.
      if (!leaving) {
        working.current = false;
        setPhase("idle");
      }
    }
  }

  const fileId = `${uid}-file`;
  const statusText =
    phase === "preparing" ? "Getting ready…" : phase === "checking" ? "Checking your file…" : `Uploading ${percent}%`;

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {formError ? <FormMessage tone="error" title={formError} /> : null}

      <fieldset disabled={busy} className="contents">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={fileId} className="text-sm font-medium">
            File
          </label>
          <input
            ref={fileInput}
            id={fileId}
            name="file"
            type="file"
            accept={UPLOAD_ACCEPT}
            onChange={onFileChange}
            aria-invalid={errors.file ? true : undefined}
            aria-describedby={describedBy(fileId, true, errors.file)}
            className={cn(
              "block min-h-28 w-full min-w-0 cursor-pointer rounded-xl border-2 border-dashed border-input bg-card p-4 text-base outline-none",
              "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive",
              "file:mr-4 file:h-11 file:cursor-pointer file:rounded-lg file:border-0 file:bg-primary file:px-4 file:text-base file:font-medium file:text-primary-foreground",
            )}
          />
          <FieldHint id={`${fileId}-hint`}>
            PDF, Word, PowerPoint, Excel, text, CSV or an image (PNG, JPG, GIF, WebP). Up to {MAX_MB} MB.
          </FieldHint>
          {errors.file ? <FieldError id={`${fileId}-error`}>{errors.file}</FieldError> : null}
        </div>

        <TextField
          label="Title"
          name="title"
          id={`${uid}-title`}
          autoComplete="off"
          value={title}
          onChange={(event) => {
            titleTouched.current = true;
            setTitle(event.target.value);
          }}
          error={errors.title}
        />
        <TypeSelect id={`${uid}-type`} types={types} value={typeId} onChange={(event) => setTypeId(event.target.value)} error={errors.type} />
        {typeId === OTHER_TYPE_ID ? (
          <OtherTextField
            id={`${uid}-other`}
            value={typeOther}
            onChange={(event) => setTypeOther(event.target.value)}
            error={errors.typeOther}
          />
        ) : null}
        {specs.map((spec, index) => (
          <DetailInput
            key={spec.id}
            id={`${uid}-detail-${index}`}
            spec={spec}
            value={details[spec.id] ?? ""}
            onChange={(value) => setDetails((previous) => ({ ...previous, [spec.id]: value }))}
            error={errors[`detail:${spec.id}`]}
          />
        ))}
      </fieldset>

      {busy ? (
        <div className="flex flex-col gap-2">
          <div
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={phase === "checking" ? 100 : percent}
            aria-valuetext={statusText}
            className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${phase === "checking" ? 100 : percent}%` }}
            />
          </div>
          <p data-testid="upload-status" className="text-sm font-medium">
            {statusText}
          </p>
        </div>
      ) : null}

      <SubmitButton pending={busy} pendingLabel="Uploading…" className="sm:w-auto sm:self-start sm:px-6">
        Upload
      </SubmitButton>
    </form>
  );
}
