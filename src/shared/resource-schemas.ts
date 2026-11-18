import { z } from "zod";
import { FILE_MESSAGES } from "./file-messages";
import { FORM_LIMITS, FORM_MESSAGES } from "./form-config";
import { RESOURCE_LIMITS, classifyUpload, safeFileName } from "./resources";

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

/**
 * What a member sends about a file's type and details. Only the SHAPE and a sane size are checked
 * here; whether the type and the answers fit the group's form is validateAnswers' job (it knows
 * the form). Raw text may carry extra spaces, which validateAnswers tidies, so the raw limits are
 * wider than the limits people see.
 */
const MAX_TYPE_ID_LENGTH = 64;
const MAX_RAW_TEXT = 1000;
const MAX_DETAIL_KEYS = 40;

const typeIdSchema = z
  .string(FORM_MESSAGES.chooseType)
  .min(1, FORM_MESSAGES.chooseType)
  .max(MAX_TYPE_ID_LENGTH, FORM_MESSAGES.typeNotAvailable);

/** Missing means empty. */
const typeOtherSchema = z
  .string(FORM_MESSAGES.otherRequired)
  .max(MAX_RAW_TEXT, FORM_MESSAGES.tooLong(FORM_LIMITS.maxOtherText))
  .default("");

/** Detail id to the typed text or the chosen choice id. Missing means none. */
const detailsSchema = z
  .record(
    z.string().max(MAX_TYPE_ID_LENGTH, FORM_MESSAGES.detailUnknown),
    z.string(FORM_MESSAGES.required).max(MAX_RAW_TEXT, FORM_MESSAGES.tooLong(FORM_LIMITS.maxAnswer)),
  )
  .refine((details) => Object.keys(details).length <= MAX_DETAIL_KEYS, FILE_MESSAGES.badForm)
  .default({});

/** The type and the details on their own, so a bad title and a bad detail can be reported together. */
export const answersInputSchema = z.object({
  typeId: typeIdSchema,
  typeOther: typeOtherSchema,
  details: detailsSchema,
});

/** What a person may change about a file after it is uploaded: its title, type and details. */
export const fileDetailsSchema = z.object({
  title: titleSchema,
  typeId: typeIdSchema,
  typeOther: typeOtherSchema,
  details: detailsSchema,
});

/**
 * What the browser says about the file it is about to send, plus the title, type and details.
 * Field errors are keyed `title`, `typeId`, `typeOther`, `details`, and `fileName` (a kind of file
 * we do not take) and `sizeBytes` (empty or too big), which the form shows next to the file picker;
 * the use-case renames the answer keys to `type`, `typeOther` and `detail:<id>`.
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
