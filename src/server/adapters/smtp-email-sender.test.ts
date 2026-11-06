import { describe, expect, test } from "vitest";
import { createSmtpEmailSender } from "./smtp-email-sender";

function fakeTransport() {
  const sent: Record<string, unknown>[] = [];
  return {
    sent,
    transport: {
      sendMail: async (message: Record<string, unknown>) => {
        sent.push(message);
      },
      verify: async () => true,
    },
  };
}

describe("createSmtpEmailSender", () => {
  test("sends from the configured address to every recipient", async () => {
    const { sent, transport } = fakeTransport();
    const sender = createSmtpEmailSender(transport, "bot@gmail.com");
    await sender.send({ to: ["a@x.com", "b@x.com"], subject: "Invite", text: "Join us" });
    expect(sent).toEqual([
      { from: "bot@gmail.com", to: "a@x.com, b@x.com", subject: "Invite", text: "Join us", html: undefined },
    ]);
  });

  test("rejects line breaks in the subject, which could inject extra headers", async () => {
    const { sent, transport } = fakeTransport();
    const sender = createSmtpEmailSender(transport, "bot@gmail.com");
    await expect(sender.send({ to: "a@x.com", subject: "Hi\r\nBcc: evil@x.com", text: "x" })).rejects.toThrow(
      /line break/i,
    );
    expect(sent).toEqual([]);
  });

  test("rejects line breaks in a recipient address", async () => {
    const { transport } = fakeTransport();
    const sender = createSmtpEmailSender(transport, "bot@gmail.com");
    await expect(sender.send({ to: "a@x.com\nBcc: evil@x.com", subject: "Hi", text: "x" })).rejects.toThrow(
      /line break/i,
    );
  });

  test("rejects an empty recipient list", async () => {
    const { transport } = fakeTransport();
    const sender = createSmtpEmailSender(transport, "bot@gmail.com");
    await expect(sender.send({ to: [], subject: "Hi", text: "x" })).rejects.toThrow(/recipient/i);
  });

  test("verify passes the connection check through", async () => {
    const { transport } = fakeTransport();
    await expect(createSmtpEmailSender(transport, "bot@gmail.com").verify()).resolves.toBeUndefined();
  });
});
