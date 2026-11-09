import { FileText } from "lucide-react";

/**
 * The Library tab. Sharing files is not built yet, so it says so plainly: no sample files and no
 * upload button that would not work. The layout has already checked that the person may see the group.
 */
export default function LibraryPage() {
  return (
    <section aria-labelledby="library-heading">
      <h2 id="library-heading" className="sr-only">
        Library
      </h2>
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
        <FileText className="size-8 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-xl font-semibold">No files here yet</h3>
        <p className="max-w-prose text-muted-foreground">
          Sharing notes and papers is not available yet. When it is, this group&apos;s files will be listed here.
        </p>
      </div>
    </section>
  );
}
