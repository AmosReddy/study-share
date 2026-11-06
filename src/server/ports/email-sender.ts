/**
 * Port: what the app needs from email sending. Nothing here names a vendor.
 */
export type EmailMessage = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
};

export interface EmailSender {
  /** Sends one message. Throws if it cannot be handed to the email service. */
  send(message: EmailMessage): Promise<void>;

  /** Checks the connection and credentials without sending anything. */
  verify(): Promise<void>;
}
