"use client";

import { useId, type ChangeEvent } from "react";
import { describedBy, FieldError, inputClassName, TextField } from "@/client/components/auth/text-field";
import { cn } from "@/client/lib/utils";
import type { DetailInputSpec, TypeChoice } from "./form-inputs";

/*
  The fields of the upload and edit forms that come from the group's form. Each one works with a
  value the form holds (`value` + `onChange`) or one the browser holds (`defaultValue`), shows its
  server or client error under it, and keeps the 44px height and 16px text of the other inputs.
*/

const selectClassName = cn(inputClassName, "pr-8");

type SelectFieldProps = {
  id: string;
  label: string;
  name: string;
  choices: { id: string; label: string }[];
  /** A first entry that means "nothing chosen" (value ""). */
  emptyLabel?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  error?: string;
};

/** A labelled native select (phones show their own picker). */
function SelectField({ id, label, name, choices, emptyLabel, value, defaultValue, onChange, error }: SelectFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        name={name}
        {...(value !== undefined ? { value } : { defaultValue: defaultValue ?? (emptyLabel !== undefined ? "" : choices[0]?.id) })}
        onChange={onChange}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, undefined, error)}
        className={selectClassName}
      >
        {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </select>
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}

type TypeSelectProps = {
  id: string;
  types: TypeChoice[];
  value?: string;
  defaultValue?: string;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  error?: string;
};

/** "Type": the group's kinds of file, then Other. */
export function TypeSelect({ id, types, ...rest }: TypeSelectProps) {
  return <SelectField id={id} label="Type" name="type" choices={types} {...rest} />;
}

type OtherTextFieldProps = {
  id: string;
  value?: string;
  defaultValue?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  error?: string;
};

/** "What kind of file is it?": shown right under the Type select when the type is Other. */
export function OtherTextField({ id, value, defaultValue, onChange, error }: OtherTextFieldProps) {
  return (
    <TextField
      label="What kind of file is it?"
      name="typeOther"
      id={id}
      autoComplete="off"
      {...(value !== undefined ? { value } : { defaultValue: defaultValue ?? "" })}
      onChange={onChange}
      error={error}
    />
  );
}

type DetailInputProps = {
  id: string;
  spec: DetailInputSpec;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  error?: string;
};

/**
 * One extra detail of the group's form: a text box (with the values the group already uses as
 * suggestions) or a dropdown of its choices. The label says whether it is required or optional.
 * Its field name is `d_<detail id>`, the same as in the Library's address.
 */
export function DetailInput({ id, spec, value, defaultValue, onChange, error }: DetailInputProps) {
  const listId = `${useId()}-values`;
  const label = `${spec.label} (${spec.required ? "required" : "optional"})`;
  const name = `d_${spec.id}`;
  const valueProps = value !== undefined ? { value } : { defaultValue: defaultValue ?? "" };

  if (spec.kind === "dropdown") {
    return (
      <SelectField
        id={id}
        label={label}
        name={name}
        choices={spec.options}
        emptyLabel="Choose one"
        {...valueProps}
        onChange={(event) => onChange?.(event.target.value)}
        error={error}
      />
    );
  }
  const hasSuggestions = spec.suggestions.length > 0;
  return (
    <>
      <TextField
        label={label}
        name={name}
        id={id}
        autoComplete="off"
        {...(hasSuggestions ? { list: listId } : {})}
        {...valueProps}
        onChange={(event) => onChange?.(event.target.value)}
        error={error}
        hint={hasSuggestions ? "Pick one the group already uses to keep the library tidy, or type your own." : undefined}
      />
      {hasSuggestions ? (
        <datalist id={listId}>
          {spec.suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      ) : null}
    </>
  );
}
