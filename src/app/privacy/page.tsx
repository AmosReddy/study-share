import type { Metadata } from "next";
import { ContactLink, LegalPage } from "@/client/components/auth/legal-page";
import { CONTACT_EMAIL, TERMS_VERSION } from "@/shared/legal";

export const metadata: Metadata = { title: "Privacy | study-share" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Notice" updated={TERMS_VERSION}>
      <p>This explains, in plain words, what study-share keeps about you and why.</p>

      <h2>What we collect</h2>
      <ul>
        <li>Your name and email address, to create your account and send sign-in emails.</li>
        <li>If you sign in with Google: your name and email address from Google. We do not get your Google password.</li>
        <li>The groups you belong to, and your role in them.</li>
        <li>The date you accepted the terms and that you confirmed you are 18 or older.</li>
        <li>
          Short-lived technical records, such as recent sign-in attempts and the network address they came from, to
          keep accounts safe and stop abuse.
        </li>
      </ul>
      <p>Files and messages will be added in later versions. This notice will be updated before they are.</p>

      <h2>Cookies and abuse protection</h2>
      <ul>
        <li>We use a small set of cookies to keep you signed in. We do not use advertising or tracking cookies.</li>
        <li>
          To stop abuse we keep short-lived counters of sign-up and login attempts, keyed by email address and IP
          address. They are kept only briefly.
        </li>
      </ul>

      <h2>Who can see it</h2>
      <ul>
        <li>People in your groups see your name and that you are a member.</li>
        <li>
          The services that run the site (hosting, database and email) process your data for us. We do not sell it or
          use it for advertising.
        </li>
      </ul>

      <h2>Age</h2>
      <p>study-share is only for people who are 18 or older.</p>

      <h2>Deleting your data</h2>
      <p>
        You can ask us to delete your account and everything linked to it at any time by writing to{" "}
        <ContactLink email={CONTACT_EMAIL} />. We will confirm once it is done.
      </p>

      <h2>Contact</h2>
      <p>
        For any question about your data, write to <ContactLink email={CONTACT_EMAIL} />.
      </p>
    </LegalPage>
  );
}
