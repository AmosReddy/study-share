/*
  Looks at the first bytes of a stored file to check it is what its type says. This is the second
  check after the extension and declared type (classifyUpload): a person can name anything
  "notes.pdf", but cannot make an HTML page start with %PDF-.

  Limits, on purpose: a file that starts like a ZIP passes as a Word, PowerPoint or Excel file
  (those are ZIPs); it is only ever downloaded, never shown in the browser. Text and CSV pass when
  the first 4096 bytes hold no NUL byte, so a UTF-16 text file (which has them) is refused.
*/

/** How many bytes completeUpload reads to decide. */
export const SNIFF_BYTES = 4096;

const startsWith = (sample: Uint8Array, signature: readonly number[], at = 0) =>
  sample.length >= at + signature.length && signature.every((byte, i) => sample[at + i] === byte);

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

const PDF = ascii("%PDF-");
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const GIF87 = ascii("GIF87a");
const GIF89 = ascii("GIF89a");
const RIFF = ascii("RIFF");
const WEBP = ascii("WEBP");
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const OFFICE_ZIP_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const OFFICE_OLE_TYPES = ["application/msword", "application/vnd.ms-powerpoint", "application/vnd.ms-excel"];

/**
 * True when `sample` (the start of the file) fits the canonical content type. A type this does not
 * know never matches.
 */
export function contentMatchesType(contentType: string, sample: Uint8Array): boolean {
  switch (contentType) {
    case "application/pdf":
      return startsWith(sample, PDF);
    case "image/png":
      return startsWith(sample, PNG);
    case "image/jpeg":
      return startsWith(sample, JPEG);
    case "image/gif":
      return startsWith(sample, GIF87) || startsWith(sample, GIF89);
    case "image/webp":
      return startsWith(sample, RIFF) && startsWith(sample, WEBP, 8);
    case "text/plain":
    case "text/csv":
      return sample.length > 0 && !sample.includes(0);
    default:
      if (OFFICE_ZIP_TYPES.includes(contentType)) return startsWith(sample, ZIP);
      if (OFFICE_OLE_TYPES.includes(contentType)) return startsWith(sample, OLE);
      return false;
  }
}
