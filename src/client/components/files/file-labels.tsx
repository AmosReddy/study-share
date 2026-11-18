/*
  How a file's type and details read in the Library rows and on the file page. Nothing here is
  client-only, so server components use it. A removed type, choice or detail is marked "(removed)":
  the file keeps it, the group's form no longer offers it. Only labels and values are shown, never ids.
*/

/** What a file's details look like to these components (the server's FileView has at least these). */
export type DetailLabel = { fieldId: string; label: string; display: string; removed: boolean; valueRemoved: boolean };

/** The type's text for the badge: "Notes", "Other: Lab manual", "Old exam (removed)". */
export function typeBadgeText(file: { typeLabel: string; typeRemoved: boolean }): string {
  return file.typeRemoved ? `${file.typeLabel} (removed)` : file.typeLabel;
}

/** "Subject: Physics", "Semester: Sem 3 (removed)", "Year (removed): 2019". */
export function detailText(detail: DetailLabel): string {
  const label = detail.removed ? `${detail.label} (removed)` : detail.label;
  return `${label}: ${detail.display}${detail.valueRemoved ? " (removed)" : ""}`;
}

/** The details that have a value, as small labels. */
export function DetailLabels({ details }: { details: DetailLabel[] }) {
  return details
    .filter((detail) => detail.display !== "")
    .map((detail) => (
      <span key={detail.fieldId} data-testid="detail-label" className="max-w-full rounded-md border px-1.5 py-0.5 text-xs [overflow-wrap:anywhere]">
        {detailText(detail)}
      </span>
    ));
}
