"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type ChangeEvent, type FormEvent } from "react";
import { inputClassName } from "@/client/components/auth/text-field";
import { Button } from "@/client/components/ui/button";
import { cn } from "@/client/lib/utils";
import { canonicalSubject, cleanSearchText, libraryHref, type LibraryFilters } from "@/shared/library-query";
import { MAX_SEARCH_LENGTH } from "@/shared/resource-schemas";
import { RESOURCE_TYPES, RESOURCE_TYPE_VALUES } from "@/shared/resources";

type LibraryFiltersProps = {
  /** The Library's own address, "/groups/<id>". */
  base: string;
  /** What the address asks for right now (the server has already cleaned it). */
  filters: LibraryFilters;
  /** Every subject the group's files use. */
  subjects: string[];
  /** True when any search or filter is on, which is when "Clear" shows. */
  active: boolean;
};

const selectClassName = cn(inputClassName, "pr-8");

/**
 * The search box and the Type and Subject dropdowns above the Library list.
 *
 * It is a real GET form: without JavaScript, "Search" loads /groups/<id>?q=...&type=...&subject=...
 * and the server does the rest. With JavaScript the same form is sent through the router (no full
 * page load), and the two dropdowns apply as soon as they change. Either way the address holds
 * the whole state and carries no page cursor, so a new search always starts at the first page.
 */
export function LibraryFilterForm({ base, filters, subjects, active }: LibraryFiltersProps) {
  const router = useRouter();
  const uid = useId();
  const subject = canonicalSubject(filters.subject, subjects);

  const [q, setQ] = useState(filters.q);
  const [type, setType] = useState<string>(filters.type);
  const [chosenSubject, setChosenSubject] = useState(subject);
  // When the address changes (Back, Forward, Clear), the boxes follow it.
  const addressState = `${filters.q}\n${filters.type}\n${subject}`;
  const [seen, setSeen] = useState(addressState);
  if (seen !== addressState) {
    setSeen(addressState);
    setQ(filters.q);
    setType(filters.type);
    setChosenSubject(subject);
  }

  /** Goes to the first page of the results for these boxes. */
  function go(next: { q: string; type: string; subject: string }) {
    const typeKey = RESOURCE_TYPE_VALUES.find((value) => value === next.type) ?? "";
    router.push(libraryHref(base, { q: cleanSearchText(next.q), type: typeKey, subject: next.subject }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    go({ q, type, subject: chosenSubject });
  }

  function onType(event: ChangeEvent<HTMLSelectElement>) {
    setType(event.target.value);
    go({ q, type: event.target.value, subject: chosenSubject });
  }

  function onSubject(event: ChangeEvent<HTMLSelectElement>) {
    setChosenSubject(event.target.value);
    go({ q, type, subject: event.target.value });
  }

  // A subject from the address that the group does not use (an old link) stays visible, so the
  // person can see what is filtering and clear it.
  const offered = chosenSubject !== "" && !subjects.includes(chosenSubject) ? [...subjects, chosenSubject] : subjects;

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
            {RESOURCE_TYPE_VALUES.map((value) => (
              <option key={value} value={value}>
                {RESOURCE_TYPES[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${uid}-subject`} className="text-sm font-medium">
            Subject
          </label>
          <select id={`${uid}-subject`} name="subject" value={chosenSubject} onChange={onSubject} className={selectClassName}>
            <option value="">All subjects</option>
            {offered.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
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
