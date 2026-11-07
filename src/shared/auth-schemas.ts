import { z } from "zod";

/** Counts characters people see (code points), so an emoji is one, not two. */
function characterCount(value: string): number {
  return Array.from(value).length;
}

export const displayNameSchema = z
  .string()
  .trim()
  .refine((name) => characterCount(name) >= 2, "Use at least 2 characters.")
  .refine((name) => characterCount(name) <= 50, "Use 50 characters or fewer.");

/** Emails are compared lowercase and without stray spaces everywhere. */
const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address."));

/** Never trimmed: spaces may be part of a person's password. */
const newPasswordSchema = z.string().min(8, "Use at least 8 characters.");

export const signUpSchema = z.object({
  displayName: displayNameSchema,
  email: emailSchema,
  password: newPasswordSchema,
  acceptTerms: z.literal(true, "You need to accept the terms to sign up."),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  password: newPasswordSchema,
});

/** Emailed codes are this many digits long (the Supabase "Email OTP length" must match). */
export const CODE_LENGTH = 6;

const CODE_PATTERN = new RegExp(`^[0-9]{${CODE_LENGTH}}$`);

/**
 * A typed or pasted code as the CODE_LENGTH digits, or null when it is not one. Spaces and
 * dashes anywhere are dropped (people paste "123 456" or "123-456"); anything else, such as
 * letters, other digit scripts or the wrong length, is refused rather than guessed at.
 */
export function normalizeCode(input: string): string | null {
  const code = input.replace(/[\s-]/g, "");
  return CODE_PATTERN.test(code) ? code : null;
}

export type SignUpInput = z.infer<typeof signUpSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
