import { RESOURCE_LIMITS } from "./resources";

/**
 * Every sentence the file use-cases show, in one place so the owner can change the wording.
 * None of them names a person, a storage key or anything from the database.
 */
export const FILE_MESSAGES = {
  titleRequired: "Give the file a title.",
  titleTooLong: `Use ${RESOURCE_LIMITS.maxTitle} characters or fewer.`,
  subjectTooLong: `Use ${RESOURCE_LIMITS.maxSubject} characters or fewer.`,
  oddCharacter: "Remove the unusual character and try again.",
  chooseType: "Choose what kind of file this is.",
  chooseFile: "Choose a file to upload.",
  fileEmpty: "That file is empty.",
  fileTooBig: `That file is larger than ${RESOURCE_LIMITS.maxFileBytes / (1024 * 1024)} MB. Choose a smaller one.`,
  fileTypeNotAllowed:
    "That kind of file can't be shared here. Use a PDF, Word, PowerPoint, Excel, text or CSV file, or an image (PNG, JPG, GIF or WebP).",
  tooMany: "Too many uploads. Please try again later.",
  badForm: "Check the form and try again.",
  couldNotSave: "We couldn't save that right now. Please try again.",
  couldNotStartUpload: "We couldn't start that upload right now. Please try again.",
  /** The same answer for a file that does not exist, a file in a group the person is not in, and a file that is not theirs to change. */
  notFound: "That file isn't available.",
  uploadMissing: "We didn't receive the whole file. Please choose it and upload it again.",
  /** Shown when the stored file turns out not to be what its name says. `kind` is a FILE_CATEGORY_LABELS value. */
  doesNotLookLike: (kind: string) =>
    `That file does not look like a ${kind}. Check that it is the right file, then upload it again.`,
  formerMember: "Former member",
} as const;
