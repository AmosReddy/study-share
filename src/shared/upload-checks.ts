import { FILE_MESSAGES } from "./file-messages";
import { ALLOWED_FILE_TYPES, RESOURCE_LIMITS, classifyUpload, safeFileName } from "./resources";

/** The extensions the file picker offers (`accept`), such as ".pdf,.doc,.docx". The server checks again. */
export const UPLOAD_ACCEPT = Object.keys(ALLOWED_FILE_TYPES)
  .map((extension) => `.${extension}`)
  .join(",");

/**
 * The friendly problem with a file the person just chose, or null when it looks fine. The same
 * rules the server applies (kind by extension, not empty, at most 25 MB), so the person hears
 * about it before anything is sent.
 */
export function checkChosenFile(file: { name: string; size: number }): string | null {
  if (!classifyUpload(safeFileName(file.name), "").ok) return FILE_MESSAGES.fileTypeNotAllowed;
  if (file.size <= 0) return FILE_MESSAGES.fileEmpty;
  if (file.size > RESOURCE_LIMITS.maxFileBytes) return FILE_MESSAGES.fileTooBig;
  return null;
}

/**
 * The content type to send for a file: the canonical one for its extension, never what the
 * browser guessed (browsers send odd types for CSV and Office files). It is also the type the
 * upload link is bound to, so the PUT must carry exactly this. Empty for a kind we do not take.
 */
export function uploadContentType(fileName: string): string {
  const classified = classifyUpload(safeFileName(fileName), "");
  return classified.ok ? classified.contentType : "";
}

/** A first title for a chosen file: its name without the extension, cut to the title limit. */
export function titleFromFileName(fileName: string): string {
  const name = safeFileName(fileName);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return [...stem.replace(/\s+/g, " ").trim()].slice(0, RESOURCE_LIMITS.maxTitle).join("").trim();
}
