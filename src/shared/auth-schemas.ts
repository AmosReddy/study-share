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

export type SignUpInput = z.infer<typeof signUpSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
