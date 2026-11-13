import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { UploadForm } from "@/client/components/files/upload-form";
import { Skeleton } from "@/client/components/ui/skeleton";
import { requireFileDeps } from "@/server/files/request-deps";
import { listFiles } from "@/server/files/use-cases";
import { completeUploadAction, prepareUploadAction } from "../../file-actions";

export default function UploadPage({ params }: PageProps<"/groups/[id]/upload">) {
  return (
    <Suspense fallback={<Skeleton aria-busy="true" className="h-96 w-full max-w-xl" />}>
      <Upload params={params} />
    </Suspense>
  );
}

/** Any member may upload. Anyone else gets the plain not-found page (the layout checks too). */
async function Upload({ params }: Pick<PageProps<"/groups/[id]/upload">, "params">) {
  const { id } = await params;
  const deps = await requireFileDeps(id);
  const library = await listFiles(deps, id);
  if (!library) notFound();

  return (
    <section aria-labelledby="upload-heading" className="flex flex-col gap-5">
      <Link
        href={`/groups/${id}`}
        className="inline-flex min-h-11 items-center gap-2 self-start font-medium underline-offset-4 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to the library
      </Link>
      <h2 id="upload-heading" className="text-xl font-semibold">
        Upload a file
      </h2>
      <div className="max-w-xl">
        <UploadForm
          groupId={id}
          subjects={library.subjects}
          prepareAction={prepareUploadAction}
          completeAction={completeUploadAction}
        />
      </div>
    </section>
  );
}
