import "server-only";
import nodemailer from "nodemailer";
import { z } from "zod";
import type { EmailMessage, EmailSender } from "@/server/ports/email-sender";

/** The two methods we use from the vendor's mail client, so tests can pass a stand-in. */
export type MailTransport = {
  sendMail(message: Record<string, unknown>): Promise<unknown>;
  verify(): Promise<unknown>;
};

const LINE_BREAK = /[\r\n]/;

/** One message may go to this many people. Matches the daily limit on email invites. */
const MAX_RECIPIENTS = 50;

const singleAddress = z.email();

/**
 * Adapter: any SMTP email service (Gmail, Resend, Brevo). Switching means
 * changing the SMTP_* settings, not this code.
 *
 * `from` is the address mail is sent from. It may include a display name,
 * for example "StudyShare <hello@example.com>".
 */
export function createSmtpEmailSender(transport: MailTransport, from: string): EmailSender {
  return {
    async send({ to, subject, text, html }: EmailMessage) {
      const recipients = Array.isArray(to) ? to : [to];
      if (recipients.length === 0) throw new Error("An email needs at least one recipient");
      if (recipients.length > MAX_RECIPIENTS) {
        throw new Error(`An email can have at most ${MAX_RECIPIENTS} recipients`);
      }
      // A line break in these would let a caller add extra headers (for example a hidden Bcc).
      if ([subject, ...recipients].some((value) => LINE_BREAK.test(value))) {
        throw new Error("Email subject and recipients must not contain a line break");
      }
      // The mail library reads each recipient as an address LIST, so "a@x.com, b@y.com" or
      // '"Name" <x@y.com>' would reach more people than the one that was typed. Accept only
      // a single plain address in each entry.
      if (recipients.some((address) => !singleAddress.safeParse(address).success)) {
        throw new Error("Each recipient must be a single valid email address");
      }
      await transport.sendMail({ from, to: recipients, subject, text, html });
    },

    async verify() {
      await transport.verify();
    },
  };
}

export type SmtpConfig = { host: string; port: number; user: string; password: string; from: string };

/** Connects to a real SMTP server. Port 465 uses an encrypted connection from the start. */
export function createSmtpEmailSenderFromConfig(config: SmtpConfig): EmailSender {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.password },
  });
  return createSmtpEmailSender(transport, config.from);
}
