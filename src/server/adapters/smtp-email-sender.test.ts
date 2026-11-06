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

const FROM = "bot@gmail.com";

async function rejects(to: string | string[], subject = "Hi") {
  const { sent, transport } = fakeTransport();
  await expect(createSmtpEmailSender(transport, FROM).send({ to, subject, text: "x" })).rejects.toThrow();
  expect(sent).toEqual([]);
}

describe("createSmtpEmailSender", () => {
  test("sends from the configured address to every recipient", async () => {
    const { sent, transport } = fakeTransport();
    const sender = createSmtpEmailSender(transport, FROM);
    await sender.send({ to: ["a@x.com", "b@x.com"], subject: "Invite", text: "Join us" });
    expect(sent).toEqual([
      { from: FROM, to: ["a@x.com", "b@x.com"], subject: "Invite", text: "Join us", html: undefined },
    ]);
  });

  test("can send from a display name and address that differ from the login", async () => {
    const { sent, transport } = fakeTransport();
    await createSmtpEmailSender(transport, "StudyShare <hello@example.com>").send({
      to: "a@x.com",
      subject: "Hi",
      text: "x",
    });
    expect(sent[0]).toMatchObject({ from: "StudyShare <hello@example.com>" });
  });

  test("rejects line breaks in the subject, which could inject extra headers", async () => {
    await rejects("a@x.com", "Hi\r\nBcc: evil@x.com");
  });

  test("rejects line breaks in a recipient address", async () => {
    await rejects("a@x.com\nBcc: evil@x.com");
  });

  test("rejects an empty recipient list", async () => {
    await rejects([]);
  });

  // One typed value must never become several recipients: that would let a single
  // invite box turn the platform's email account into a spam relay.
  test.each([
    ["a comma-separated list", "a@x.com, b@y.com"],
    ["a semicolon-separated list", "a@x.com; b@y.com"],
    ["a name with angle brackets", '"Evil" <evil@x.com>'],
    ["bare angle brackets", "<evil@x.com>"],
    ["an address with spaces", "a b@x.com"],
    ["no @ sign", "not-an-address"],
    ["an empty string", ""],
  ])("rejects %s as a single recipient", async (_label, value) => {
    await rejects(value);
  });

  test("rejects a bad address hiding inside a list of good ones", async () => {
    await rejects(["a@x.com", "b@y.com, c@z.com"]);
  });

  test("rejects too many recipients in one message", async () => {
    await rejects(Array.from({ length: 51 }, (_, i) => `user${i}@x.com`));
  });

  test("accepts 50 recipients, the daily invite limit", async () => {
    const { sent, transport } = fakeTransport();
    await createSmtpEmailSender(transport, FROM).send({
      to: Array.from({ length: 50 }, (_, i) => `user${i}@x.com`),
      subject: "Hi",
      text: "x",
    });
    expect(sent).toHaveLength(1);
  });

  test("verify passes the connection check through", async () => {
    const { transport } = fakeTransport();
    await expect(createSmtpEmailSender(transport, FROM).verify()).resolves.toBeUndefined();
  });
});
