"use client";

import { useId, type ChangeEvent } from "react";
import { describedBy, FieldError, inputClassName, TextField } from "@/client/components/auth/text-field";
import { cn } from "@/client/lib/utils";
import { RESOURCE_TYPES, RESOURCE_TYPE_VALUES } from "@/shared/resources";

type TypeSelectProps = {
  id: string;
  /** The form field's name (the upload form is not a native form post, so it may leave this out). */
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  error?: string;
};

/** "Type": the five kinds of file, as a native select (phones show their own picker). */
export function TypeSelect({ id, name = "type", value, defaultValue, onChange, error }: TypeSelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        Type
      </label>
      <select
        id={id}
        name={name}
        {...(value !== undefined ? { value } : { defaultValue: defaultValue ?? RESOURCE_TYPE_VALUES[0] })}
        onChange={onChange}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, undefined, error)}
        className={cn(inputClassName, "pr-8")}
      >
        {RESOURCE_TYPE_VALUES.map((type) => (
          <option key={type} value={type}>
            {RESOURCE_TYPES[type]}
          </option>
        ))}
      </select>
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}

type SubjectFieldProps = {
  id: string;
  /** Subjects the group already uses, offered as suggestions while typing. */
  suggestions: string[];
  value?: string;
  defaultValue?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  error?: string;
};

/** "Subject (optional)": free text, with the group's existing subjects as suggestions. */
export function SubjectField({ id, suggestions, value, defaultValue, onChange, error }: SubjectFieldProps) {
  const listId = `${useId()}-subjects`;
  return (
    <>
      <TextField
        label="Subject (optional)"
        name="subject"
        id={id}
        autoComplete="off"
        list={listId}
        {...(value !== undefined ? { value } : { defaultValue: defaultValue ?? "" })}
        onChange={onChange}
        error={error}
        hint="For example Physics or Maths. Pick one the group already uses to keep the library tidy."
      />
      <datalist id={listId}>
        {suggestions.map((subject) => (
          <option key={subject} value={subject} />
        ))}
      </datalist>
    </>
  );
}
