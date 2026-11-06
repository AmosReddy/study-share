import "server-only";
import nodemailer from "nodemailer";
import type { EmailMessage, EmailSender } from "@/server/ports/email-sender";

/** The two methods we use from the vendor's mail client, so tests can pass a stand-in. */
export type MailTransport = {
  sendMail(message: Record<string, unknown>): Promise<unknown>;
  verify(): Promise<unknown>;
};

const LINE_BREAK = /[\r\n]/;

/**
 * Adapter: any SMTP email service (Gmail, Resend, Brevo). Switching means
 * changing the SMTP_* settings, not this code.
 */
export function createSmtpEmailSender(transport: MailTransport, fromAddress: string): EmailSender {
  return {
    async send({ to, subject, text, html }: EmailMessage) {
      const recipients = Array.isArray(to) ? to : [to];
      if (recipients.length === 0) throw new Error("An email needs at least one recipient");
      // A line break in these would let a caller add extra headers (for example a hidden Bcc).
      if ([subject, ...recipients].some((value) => LINE_BREAK.test(value))) {
        throw new Error("Email subject and recipients must not contain a line break");
      }
      await transport.sendMail({ from: fromAddress, to: recipients.join(", "), subject, text, html });
    },

    async verify() {
      await transport.verify();
    },
  };
}

export type SmtpConfig = { host: string; port: number; user: string; password: string };

/** Connects to a real SMTP server. Port 465 uses an encrypted connection from the start. */
export function createSmtpEmailSenderFromConfig(config: SmtpConfig): EmailSender {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.password },
  });
  return createSmtpEmailSender(transport, config.user);
}
