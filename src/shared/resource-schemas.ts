import { z } from "zod";
import { FILE_MESSAGES } from "./file-messages";
import { RESOURCE_LIMITS, RESOURCE_TYPE_VALUES, classifyUpload, safeFileName } from "./resources";

/** Counts characters people see (code points), so an emoji is one, not two. */
const characterCount = (value: string) => [...value].length;

/** Control characters (a NUL, which Postgres cannot store, among them) cannot be typed in a title. */
const hasNoControl = (text: string) => !/\p{Cc}/u.test(text);

/** Whitespace runs, tabs and line breaks become one space, then the ends are trimmed. */
const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

const titleSchema = z
  .string(FILE_MESSAGES.titleRequired)
  .transform(tidy)
  .refine(hasNoControl, FILE_MESSAGES.oddCharacter)
  .refine((title) => characterCount(title) >= 1, FILE_MESSAGES.titleRequired)
  .refine((title) => characterCount(title) <= RESOURCE_LIMITS.maxTitle, FILE_MESSAGES.titleTooLong);

/** Missing means empty. */
const subjectSchema = z
  .string(FILE_MESSAGES.subjectTooLong)
  .transform(tidy)
  .refine(hasNoControl, FILE_MESSAGES.oddCharacter)
  .refine((subject) => characterCount(subject) <= RESOURCE_LIMITS.maxSubject, FILE_MESSAGES.subjectTooLong)
  .default("");

const typeSchema = z.enum(RESOURCE_TYPE_VALUES, FILE_MESSAGES.chooseType);

/** What a person may change about a file after it is uploaded. */
export const fileDetailsSchema = z.object({
  title: titleSchema,
  subject: subjectSchema,
  type: typeSchema,
});

/**
 * What the browser says about the file it is about to send, plus the details. Field errors are
 * keyed `title`, `subject`, `type`, and `fileName` (a kind of file we do not take) and
 * `sizeBytes` (empty or too big), which the form shows next to the file picker.
 * `fileName` comes out as the cleaned name (safeFileName) and `contentType` as the canonical type.
 */
export const prepareUploadSchema = fileDetailsSchema
  .extend({
    fileName: z.string(FILE_MESSAGES.chooseFile).max(1000, FILE_MESSAGES.fileTypeNotAllowed),
    contentType: z.string().max(255).default(""),
    sizeBytes: z
      .number(FILE_MESSAGES.chooseFile)
      .int(FILE_MESSAGES.chooseFile)
      .min(1, FILE_MESSAGES.fileEmpty)
      .max(RESOURCE_LIMITS.maxFileBytes, FILE_MESSAGES.fileTooBig),
  })
  .superRefine((value, context) => {
    // Runs even when another field failed, so every problem shows at once; skip what is not text.
    if (typeof value.fileName !== "string" || typeof value.contentType !== "string") return;
    if (!classifyUpload(safeFileName(value.fileName), value.contentType).ok) {
      context.addIssue({ code: "custom", path: ["fileName"], message: FILE_MESSAGES.fileTypeNotAllowed });
    }
  })
  .transform((value) => {
    const fileName = safeFileName(value.fileName);
    const classified = classifyUpload(fileName, value.contentType);
    // superRefine has refused anything else.
    if (!classified.ok) throw new Error("unreachable: the file type was checked");
    return { ...value, fileName, contentType: classified.contentType };
  });

/** The longest search text the library looks for; a longer one is cut. */
export const MAX_SEARCH_LENGTH = 100;
