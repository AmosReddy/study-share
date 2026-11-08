import Link from "next/link";
import { CheckboxField } from "./text-field";

/** The one consent box: age and the Terms and Privacy Notice together. */
export function TermsCheckbox({ defaultChecked, error }: { defaultChecked?: boolean; error?: string }) {
  return (
    <CheckboxField
      name="acceptTerms"
      defaultChecked={defaultChecked}
      error={error}
      label={
        <>
          I am 18 or older and accept the{" "}
          <Link href="/terms" target="_blank" className="font-medium underline underline-offset-4">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" target="_blank" className="font-medium underline underline-offset-4">
            Privacy Notice
          </Link>
        </>
      }
    />
  );
}
