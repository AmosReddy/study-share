/** What a shared file is. The keys are stored in the database (see the check in the resources table). */
export const RESOURCE_TYPES = {
  notes: "Notes",
  pyq: "Previous year paper",
  study_material: "Study material",
  assignment: "Assignment",
  other: "Other",
} as const;

export type ResourceType = keyof typeof RESOURCE_TYPES;

/** The types in display order. */
export const RESOURCE_TYPE_VALUES = Object.keys(RESOURCE_TYPES) as ResourceType[];

/** A file is 'uploading' until the server has confirmed what reached storage; only 'ready' files are listed. */
export type ResourceStatus = "uploading" | "ready";

/** The length limits count characters people see (code points), as the database checks do. */
export const RESOURCE_LIMITS = {
  maxTitle: 120,
  maxSubject: 60,
  maxFileName: 200,
  maxFileBytes: 25 * 1024 * 1024,
} as const;

/** What a file is, for the sniffing in completeUpload and the wording of "does not look like a ...". */
export type FileCategory = "pdf" | "word" | "powerpoint" | "excel" | "text" | "image";

/** How people say it: "That file does not look like a Word document." */
export const FILE_CATEGORY_LABELS: Record<FileCategory, string> = {
  pdf: "PDF",
  word: "Word document",
  powerpoint: "PowerPoint presentation",
  excel: "Excel spreadsheet",
  text: "text file",
  image: "image",
};

const WORD = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const POWERPOINT = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const EXCEL = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * The file kinds the app takes, by extension (lower case, no dot). `types` lists the content types
 * browsers send for that extension; the FIRST is the canonical one we store and serve. No SVG, HTML,
 * archives or programs: nothing here can run script when it is opened.
 */
export const ALLOWED_FILE_TYPES = {
  pdf: { category: "pdf", types: ["application/pdf"] },
  doc: { category: "word", types: ["application/msword"] },
  docx: { category: "word", types: [WORD] },
  ppt: { category: "powerpoint", types: ["application/vnd.ms-powerpoint"] },
  pptx: { category: "powerpoint", types: [POWERPOINT] },
  xls: { category: "excel", types: ["application/vnd.ms-excel"] },
  xlsx: { category: "excel", types: [EXCEL] },
  txt: { category: "text", types: ["text/plain"] },
  // Windows with Excel installed makes browsers send application/vnd.ms-excel for .csv files.
  csv: { category: "text", types: ["text/csv", "application/csv", "text/comma-separated-values", "application/vnd.ms-excel"] },
  png: { category: "image", types: ["image/png", "image/x-png"] },
  jpg: { category: "image", types: ["image/jpeg", "image/pjpeg"] },
  jpeg: { category: "image", types: ["image/jpeg", "image/pjpeg"] },
  gif: { category: "image", types: ["image/gif"] },
  webp: { category: "image", types: ["image/webp"] },
} as const satisfies Record<string, { category: FileCategory; types: readonly string[] }>;

/** The content types a browser may show inline (a viewer page). Everything else is a download. */
export const PREVIEWABLE_TYPES: readonly string[] = ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"];

/** True for a type we stored and verified (not one a person typed) that may be shown in the browser. */
export function isPreviewableType(contentType: string): boolean {
  return PREVIEWABLE_TYPES.includes(contentType);
}

export type ClassifiedUpload =
  | { ok: true; extension: string; category: FileCategory; contentType: string; previewable: boolean }
  | { ok: false };

/** Browsers send these when they do not know the type (often for Office and CSV files). */
const UNKNOWN_TYPES = ["", "application/octet-stream"];

/**
 * Decides whether a file may be uploaded and with which type. The EXTENSION decides: it must be in
 * ALLOWED_FILE_TYPES. The declared type must then be one browsers send for it, or be empty or
 * application/octet-stream (accepted only for a known extension). The result carries the canonical
 * type, never the declared one. This is the first of two checks; the second reads the bytes
 * (src/server/files/sniff.ts).
 */
export function classifyUpload(fileName: string, declaredContentType: string): ClassifiedUpload {
  const dot = fileName.lastIndexOf(".");
  const extension = dot < 0 ? "" : fileName.slice(dot + 1).trim().toLowerCase();
  if (!Object.hasOwn(ALLOWED_FILE_TYPES, extension)) return { ok: false };
  const entry: { category: FileCategory; types: readonly string[] } =
    ALLOWED_FILE_TYPES[extension as keyof typeof ALLOWED_FILE_TYPES];
  const declared = (declaredContentType.split(";")[0] ?? "").trim().toLowerCase();
  if (!UNKNOWN_TYPES.includes(declared) && !entry.types.includes(declared)) return { ok: false };
  const contentType = entry.types[0];
  return { ok: true, extension, category: entry.category, contentType, previewable: isPreviewableType(contentType) };
}

/** Characters that break a path, a URL or a shell, or that Windows refuses in a file name. */
const UNSAFE_NAME_CHARACTERS = /[\\/:*?"<>|#%{}^~[\]`;]/gu;
/** Control, unassigned and private-use characters, and lone surrogates; also removes direction overrides (U+202E). */
const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cs}\p{Co}\p{Cn}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

/**
 * A file name that is safe to store, to put in a storage key and to offer for download: no path
 * parts, no control or direction-changing characters, no characters that break URLs or paths.
 * Letters of any script stay. The extension (letters and digits only, lower case) is kept and the
 * name is cut to RESOURCE_LIMITS.maxFileName characters. Never empty, and never "." or "..".
 */
export function safeFileName(name: string): string {
  const lastPart = name.toWellFormed().normalize("NFC").split(/[\\/]/).pop() ?? "";
  // Tabs and line breaks become spaces BEFORE the control characters are removed.
  const cleaned = lastPart.replace(/\s+/gu, " ").replace(HIDDEN_CHARACTERS, "").replace(UNSAFE_NAME_CHARACTERS, "_").trim();
  const dot = cleaned.lastIndexOf(".");
  const afterDot = dot < 0 ? "" : cleaned.slice(dot + 1);
  const hasExtension = /^[A-Za-z0-9]{1,10}$/.test(afterDot);
  const extension = hasExtension ? `.${afterDot.toLowerCase()}` : "";
  const stem = (hasExtension ? cleaned.slice(0, dot) : cleaned).replace(/^[\s.]+|[\s.]+$/gu, "");
  const room = RESOURCE_LIMITS.maxFileName - extension.length;
  const cut = [...(stem || "file")].slice(0, room).join("").replace(/[\s.]+$/u, "");
  return `${cut || "file"}${extension}`;
}
