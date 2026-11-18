"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type ChangeEvent, type FormEvent } from "react";
import { inputClassName } from "@/client/components/auth/text-field";
import { Button } from "@/client/components/ui/button";
import { cn } from "@/client/lib/utils";
import { canonicalValue, cleanSearchText, libraryHref, type FilterOption, type LibraryFilterOptions, type LibraryFilters } from "@/shared/library-query";
import { MAX_SEARCH_LENGTH } from "@/shared/resource-schemas";

type LibraryFiltersProps = {
  /** The Library's own address, "/groups/<id>". */
  base: string;
  /** What the address asks for right now (the server has already cleaned it). */
  filters: LibraryFilters;
  /** What the filters offer: the group's types and details, and the values its files use. */
  options: LibraryFilterOptions;
  /** True when any search or filter is on, which is when "Clear" shows. */
  active: boolean;
};

const selectClassName = cn(inputClassName, "pr-8");

/** The choices of one dropdown: the group's, plus a value from the address that the group does not offer (an old link), so the person can see what is filtering. */
function choicesWith(options: FilterOption[], chosen: string): FilterOption[] {
  const named = options.map((option) => ({ ...option, label: option.removed ? `${option.label} (removed)` : option.label }));
  return chosen !== "" && !options.some((option) => option.id === chosen) ? [...named, { id: chosen, label: chosen, removed: false }] : named;
}

/**
 * The search box and the Type and detail dropdowns above the Library list.
 *
 * It is a real GET form: without JavaScript, "Search" loads /groups/<id>?q=...&type=...&d_<id>=...
 * and the server does the rest. With JavaScript the same form is sent through the router (no full
 * page load), and the dropdowns apply as soon as they change. Either way the address holds the
 * whole state and carries no page cursor, so a new search always starts at the first page.
 *
 * TEMPORARY (custom upload form, Task 3): the dropdowns come straight from the group's form and
 * their wording is generic; Task 4 settles the layout and the words.
 */
export function LibraryFilterForm({ base, filters, options, active }: LibraryFiltersProps) {
  const router = useRouter();
  const uid = useId();
  // A text detail's value from the address is shown in the group's own spelling (the filter ignores case).
  const shown = (field: LibraryFilterOptions["fields"][number]) => {
    const value = Object.hasOwn(filters.details, field.id) ? filters.details[field.id] : "";
    return field.kind === "text" ? canonicalValue(value, field.options.map((option) => option.id)) : value;
  };
  const addressDetails = options.fields.map((field) => [field.id, shown(field)] as const);

  const [q, setQ] = useState(filters.q);
  const [type, setType] = useState(filters.type);
  const [details, setDetails] = useState<Record<string, string>>(Object.fromEntries(addressDetails));
  // When the address changes (Back, Forward, Clear), the boxes follow it.
  const addressState = JSON.stringify([filters.q, filters.type, addressDetails]);
  const [seen, setSeen] = useState(addressState);
  if (seen !== addressState) {
    setSeen(addressState);
    setQ(filters.q);
    setType(filters.type);
    setDetails(Object.fromEntries(addressDetails));
  }

  /** Goes to the first page of the results for these boxes. */
  function go(next: { q: string; type: string; details: Record<string, string> }) {
    // The form's own details only: a stray one in the address is dropped here.
    const known = options.fields.map((field) => [field.id, Object.hasOwn(next.details, field.id) ? next.details[field.id] : ""] as const);
    router.push(libraryHref(base, { q: cleanSearchText(next.q), type: next.type, details: Object.fromEntries(known) }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    go({ q, type, details });
  }

  function onType(event: ChangeEvent<HTMLSelectElement>) {
    setType(event.target.value);
    go({ q, type: event.target.value, details });
  }

  function onDetail(fieldId: string, event: ChangeEvent<HTMLSelectElement>) {
    const next = { ...details, [fieldId]: event.target.value };
    setDetails(next);
    go({ q, type, details: next });
  }

  return (
    <form method="get" action={base} role="search" aria-label="Search and filter files" onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${uid}-q`} className="text-sm font-medium">
          Search files
        </label>
        <div className="flex gap-2">
          <input
            id={`${uid}-q`}
            name="q"
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            maxLength={MAX_SEARCH_LENGTH}
            placeholder="Search by title, subject or file name"
            autoComplete="off"
            enterKeyHint="search"
            className={inputClassName}
          />
          <Button type="submit" className="h-11 shrink-0 gap-2 px-4 text-base">
            <Search className="size-4" aria-hidden="true" />
            Search
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-type`} className="text-sm font-medium">
            Type
          </label>
          <select id={`${uid}-type`} name="type" value={type} onChange={onType} className={selectClassName}>
            <option value="">All types</option>
            {choicesWith(options.types, type).map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>
        {options.fields.map((field) => (
          <div key={field.id} className="flex flex-col gap-1.5">
            <label htmlFor={`${uid}-d-${field.id}`} className="text-sm font-medium">
              {field.removed ? `${field.label} (removed)` : field.label}
            </label>
            <select
              id={`${uid}-d-${field.id}`}
              name={`d_${field.id}`}
              value={Object.hasOwn(details, field.id) ? details[field.id] : ""}
              onChange={(event) => onDetail(field.id, event)}
              className={selectClassName}
            >
              <option value="">{`All ${field.label.toLowerCase()}s`}</option>
              {choicesWith(field.options, Object.hasOwn(details, field.id) ? details[field.id] : "").map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {active ? (
        <div>
          <Button asChild variant="ghost" className="h-11 w-full px-5 text-base sm:w-auto">
            <Link href={base}>Clear</Link>
          </Button>
        </div>
      ) : null}
    </form>
  );
}
