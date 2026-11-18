import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FormEditor } from "@/client/components/groups/form-editor";
import { Skeleton } from "@/client/components/ui/skeleton";
import { getFormEditorState } from "@/server/files/form-use-cases";
import { can } from "@/server/permissions";
import { saveFormConfigAction } from "../../../file-actions";
import { loadGroupPage } from "../../load-group";

export default function UploadFormSettingsPage({ params }: PageProps<"/groups/[id]/settings/upload-form">) {
  return (
    <Suspense fallback={<Skeleton aria-busy="true" className="h-96 w-full max-w-xl" />}>
      <UploadFormEditor params={params} />
    </Suspense>
  );
}

/** Owner only. Anyone else who types the address gets the plain not-found page. */
async function UploadFormEditor({ params }: Pick<PageProps<"/groups/[id]/settings/upload-form">, "params">) {
  const { id } = await params;
  const page = await loadGroupPage(id);
  if (!page || !can(page.user, "group.form.edit", { membership: page.membership })) notFound();
  const state = await getFormEditorState(page.deps, id);
  if (!state?.canEdit) notFound();

  return (
    <section aria-labelledby="upload-form-heading" className="flex flex-col gap-5">
      <Link
        href={`/groups/${id}/settings`}
        className="inline-flex min-h-11 items-center gap-2 self-start font-medium underline-offset-4 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to settings
      </Link>
      <div className="flex flex-col gap-2">
        <h2 id="upload-form-heading" className="text-xl font-semibold">
          Upload form
        </h2>
        <p className="max-w-xl text-muted-foreground">
          Choose what members tell you when they upload a file. Changes apply to uploads that start after you save. Files already in the
          library keep what they have.
        </p>
      </div>
      <FormEditor groupId={id} config={state.formConfig} action={saveFormConfigAction} />
    </section>
  );
}
