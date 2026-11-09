import type { Metadata } from "next";
import Link from "next/link";
import { ContactLink, LegalPage } from "@/client/components/auth/legal-page";
import { CONTACT_EMAIL, TERMS_VERSION } from "@/shared/legal";

export const metadata: Metadata = { title: "Terms | study-share" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use" updated={TERMS_VERSION}>
      <p>
        study-share is a small, free site for classmates to share notes, previous year papers and study material in
        groups. By creating an account you agree to these terms.
      </p>

      <h2>Who can use it</h2>
      <p>You must be 18 or older. One account per person, in your own name.</p>

      <h2>Your account</h2>
      <ul>
        <li>Keep your password to yourself. You are responsible for what happens in your account.</li>
        <li>Use a real email address you can open, so we can confirm it and help you reset your password.</li>
      </ul>

      <h2>What you share</h2>
      <ul>
        <li>Only share material you are allowed to share. Do not upload other people&apos;s work without permission.</li>
        <li>Be respectful. No harassment, hate, spam or illegal content.</li>
        <li>You keep the rights to what you share. You let the people in your group see and use it for study.</li>
      </ul>

      <h2>What we may do</h2>
      <ul>
        <li>Remove content or accounts that break these terms, or that we are asked to remove by law.</li>
        <li>Change or stop the service. This is a pilot, so things will change; we will update this page when they do.</li>
      </ul>

      <h2>No guarantees</h2>
      <p>
        The site is offered as it is, without promises that it will always be available or free of mistakes. Keep your
        own copies of anything important.
      </p>

      <h2>Your data</h2>
      <p>
        How we handle your information is explained in the{" "}
        <Link href="/privacy" className="font-medium underline underline-offset-4">
          Privacy Notice
        </Link>
        .
      </p>

      <h2>Contact</h2>
      <p>
        Questions, or something that should be taken down? Write to <ContactLink email={CONTACT_EMAIL} />.
      </p>
    </LegalPage>
  );
}
