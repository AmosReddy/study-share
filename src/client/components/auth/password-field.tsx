"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/client/lib/utils";
import { describedBy, FieldError, FieldHint, inputClassName } from "./text-field";

type PasswordFieldProps = Omit<ComponentProps<"input">, "id" | "name" | "type"> & {
  label: string;
  name: string;
  id?: string;
  hint?: ReactNode;
  error?: string;
  /** "off" for a password that is not the person's own (a group password). */
  autoComplete: "new-password" | "current-password" | "off";
};

/** A password input with a show/hide button. Without JavaScript it is a plain password field. */
export function PasswordField({ label, name, id = name, hint, error, className, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn(inputClassName, "pr-12", className)}
          {...props}
        />
        <button
          type="button"
          aria-controls={id}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {visible ? <EyeOff className="size-5" aria-hidden="true" /> : <Eye className="size-5" aria-hidden="true" />}
        </button>
      </div>
      {hint ? <FieldHint id={`${id}-hint`}>{hint}</FieldHint> : null}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}
