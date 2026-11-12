import { z } from "zod";

export const GROUP_LIMITS = {
  maxGroupsPerPerson: 20,
  maxMembers: 300,
  nameMin: 2,
  nameMax: 60,
  descriptionMax: 300,
  passwordMin: 6,
  passwordMax: 64,
  codeLength: 8,
} as const;

/**
 * Characters a group code is made of: digits 2 to 9 and capital letters, without 0, O, 1, I and L
 * (they look alike when read aloud or copied by hand). 8 + 23 = 31 characters.
 */
export const GROUP_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export type JoinMode = "password" | "link";
export type GroupRole = "owner" | "admin" | "member";
export type MemberStatus = "active" | "pending" | "removed";

/** Counts characters people see (code points), so an emoji is one, not two. */
function characterCount(value: string): number {
  return [...value].length;
}

/**
 * A typed or pasted code: spaces and hyphens dropped (also the en dash, em dash, non-breaking
 * hyphen and minus sign a phone keyboard or a chat app may put in, and the no-break space), capitals.
 * It may still not be a valid code.
 */
export function normalizeGroupCode(raw: string): string {
  return raw.trim().replace(/[\s \-‐-―−]/g, "").toUpperCase();
}

/** Postgres cannot store a NUL character in text; one in a name or key would make it throw. */
const hasNoNul = (text: string) => !text.includes("\u0000");
const NO_NUL_MESSAGE = "Remove the unusual character and try again.";

/** No invite token (43 characters) or code (8) is longer than this. */
export const MAX_KEY_LENGTH = 100;

const CODE_PATTERN = new RegExp(`^[${GROUP_CODE_ALPHABET}]{${GROUP_LIMITS.codeLength}}$`);

/** True when the key, once normalised, is exactly codeLength characters of the alphabet. */
export function isGroupCode(key: string): boolean {
  return CODE_PATTERN.test(normalizeGroupCode(key));
}

const nameSchema = z
  .string()
  .trim()
  .refine(hasNoNul, NO_NUL_MESSAGE)
  .transform((name) => name.replace(/\s+/g, " "))
  .refine((name) => characterCount(name) >= GROUP_LIMITS.nameMin, `Use at least ${GROUP_LIMITS.nameMin} characters.`)
  .refine(
    (name) => characterCount(name) <= GROUP_LIMITS.nameMax,
    `Use ${GROUP_LIMITS.nameMax} characters or fewer.`,
  );

/** Missing means empty. */
const descriptionSchema = z
  .string()
  .trim()
  .refine(hasNoNul, NO_NUL_MESSAGE)
  .refine(
    (text) => characterCount(text) <= GROUP_LIMITS.descriptionMax,
    `Use ${GROUP_LIMITS.descriptionMax} characters or fewer.`,
  )
  .default("");

const joinModeValueSchema = z.enum(["password", "link"], "Choose how people can join.");

/** Never trimmed: spaces may be part of the password. Checked only when the mode is "password". */
const optionalPasswordSchema = z.string().optional();

type PasswordFields = { joinMode: JoinMode; password?: string };

/** Password mode needs a password of the allowed length; link mode ignores and drops any typed one. */
function applyPasswordRule<T extends PasswordFields>(value: T, ctx: z.RefinementCtx): void {
  if (value.joinMode !== "password") return;
  const length = characterCount(value.password ?? "");
  if (length < GROUP_LIMITS.passwordMin) {
    ctx.addIssue({
      code: "custom",
      path: ["password"],
      message: `Use at least ${GROUP_LIMITS.passwordMin} characters.`,
    });
  } else if (length > GROUP_LIMITS.passwordMax) {
    ctx.addIssue({
      code: "custom",
      path: ["password"],
      message: `Use ${GROUP_LIMITS.passwordMax} characters or fewer.`,
    });
  }
}

function dropLinkPassword<T extends PasswordFields>(value: T): T & { password: string | undefined } {
  return { ...value, password: value.joinMode === "password" ? value.password : undefined };
}

export const createGroupSchema = z
  .object({
    name: nameSchema,
    description: descriptionSchema,
    joinMode: joinModeValueSchema,
    password: optionalPasswordSchema,
  })
  .superRefine(applyPasswordRule)
  .transform(dropLinkPassword);

export const editGroupSchema = z.object({
  name: nameSchema,
  description: descriptionSchema,
});

export const joinModeSchema = z
  .object({
    joinMode: joinModeValueSchema,
    password: optionalPasswordSchema,
  })
  .superRefine(applyPasswordRule)
  .transform(dropLinkPassword);

/** An id (UUID) in any letter case, handed on lower-case. Never trimmed: it is an id, not typed text. */
export const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  .transform((id) => id.toLowerCase());

/** The id of the person who becomes the owner. */
export const transferOwnershipSchema = z.object({
  targetUserId: uuidSchema,
});

/**
 * A group name as compared when someone types it to confirm a delete: Unicode-normalised (NFC, so
 * "é" typed either way matches), trimmed, runs of whitespace as one space. Case still counts. The
 * confirm sheet and the server both use this, so the button enables exactly when the server accepts.
 */
export function normalizeGroupNameForCompare(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ");
}

/** The name typed to confirm a delete; the server compares it with the group's current name. */
export const deleteGroupSchema = z.object({
  confirmName: z
    .string()
    .trim()
    .refine(hasNoNul, NO_NUL_MESSAGE)
    .refine((name) => characterCount(name) >= 1 && characterCount(name) <= MAX_KEY_LENGTH),
});

/** The key is an invite token or a group code from the address; the password is never trimmed. */
export const joinGroupSchema = z.object({
  key: z.string().trim().min(1).max(MAX_KEY_LENGTH).refine(hasNoNul, NO_NUL_MESSAGE),
  password: z.string().optional(),
});

export const joinCodeSchema = z.object({
  code: z
    .string()
    .transform(normalizeGroupCode)
    .refine(isGroupCode, "That is not a valid group code."),
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type EditGroupInput = z.infer<typeof editGroupSchema>;
export type JoinModeInput = z.infer<typeof joinModeSchema>;
export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;
export type DeleteGroupInput = z.infer<typeof deleteGroupSchema>;
export type JoinGroupInput = z.infer<typeof joinGroupSchema>;
export type JoinCodeInput = z.infer<typeof joinCodeSchema>;
