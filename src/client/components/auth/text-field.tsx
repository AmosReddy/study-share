import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/client/lib/utils";

/** 44px tall and 16px text, so phones do not zoom in on focus. */
export const inputClassName =
  "h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base text-foreground shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30";

/** Ids for a field's hint and error, joined for `aria-describedby`. */
export function describedBy(id: string, hint?: ReactNode, error?: string): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-sm font-medium text-destructive">
      {children}
    </p>
  );
}

export function FieldHint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-sm text-muted-foreground">
      {children}
    </p>
  );
}

type TextFieldProps = Omit<ComponentProps<"input">, "id" | "name"> & {
  label: string;
  name: string;
  id?: string;
  hint?: ReactNode;
  error?: string;
};

/** A labelled input with its hint and error tied to it. */
export function TextField({ label, name, id = name, hint, error, className, ...props }: TextFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(inputClassName, className)}
        {...props}
      />
      {hint ? <FieldHint id={`${id}-hint`}>{hint}</FieldHint> : null}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}

/** The email field, with the attributes phones and password managers need. */
export function EmailField(props: Omit<TextFieldProps, "label" | "name"> & { label?: string; name?: string }) {
  return (
    <TextField
      label="Email"
      name="email"
      type="email"
      inputMode="email"
      autoComplete="email"
      autoCapitalize="none"
      spellCheck={false}
      {...props}
    />
  );
}

type CheckboxFieldProps = Omit<ComponentProps<"input">, "id" | "name" | "type"> & {
  name: string;
  id?: string;
  label: ReactNode;
  error?: string;
};

/** A checkbox with a large tap area: the whole label row toggles it. */
export function CheckboxField({ name, id = name, label, error, ...props }: CheckboxFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-3">
        <input
          id={id}
          name={name}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, undefined, error)}
          className="mt-0.5 size-5 shrink-0 cursor-pointer rounded border-input accent-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:outline-2 aria-invalid:outline-destructive"
          {...props}
        />
        <label htmlFor={id} className="cursor-pointer text-sm leading-6">
          {label}
        </label>
      </div>
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}
