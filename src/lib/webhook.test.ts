import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseStatusUpdates, parseWebhookPayload, verifySignature, type WebhookPayload } from "@/lib/webhook";

const wrap = (value: Record<string, unknown>): WebhookPayload =>
  ({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value }] }] }) as WebhookPayload;

const textMessage = (body: string) => ({
  contacts: [{ profile: { name: "Dewi" }, wa_id: "6285110525118" }],
  messages: [{ from: "6285110525118", id: "wamid.1", timestamp: "1", type: "text", text: { body } }],
});

describe("parseWebhookPayload", () => {
  it("extracts a customer message with the contact name", () => {
    expect(parseWebhookPayload(wrap(textMessage("Hello")))).toEqual([
      { id: "wamid.1", from: "6285110525118", name: "Dewi", text: "Hello" },
    ]);
  });

  it("ignores delivery reports, other objects and empty payloads", () => {
    expect(parseWebhookPayload(wrap({ statuses: [{ id: "wamid.1", status: "read" }] }))).toEqual([]);
    expect(parseWebhookPayload({ object: "page", entry: [] })).toEqual([]);
    expect(parseWebhookPayload(null)).toEqual([]);
  });

  it("ignores messages sent to another number on the same account", () => {
    const payload = wrap({ ...textMessage("Hi"), metadata: { phone_number_id: "111" } });
    expect(parseWebhookPayload(payload, "222")).toEqual([]);
    expect(parseWebhookPayload(payload, "111")).toHaveLength(1);
  });

  it("describes non-text messages and skips ones with nothing to show", () => {
    const messages = parseWebhookPayload(
      wrap({
        messages: [
          { id: "a", from: "1", type: "image", image: { caption: "Is this swollen?" } },
          { id: "b", from: "1", type: "audio", audio: {} },
          { id: "c", from: "1", type: "reaction", reaction: { emoji: "x" } },
          { id: "d", from: "1", type: "location", location: { latitude: 1, longitude: 2, name: "Clinic", address: "Jl. Sudirman" } },
          { id: "e", from: "1", type: "interactive", interactive: { button_reply: { title: "Book now" } } },
          { id: "f", from: "1", type: "order", order: {} },
        ],
      })
    );
    expect(messages.map((m) => m.text)).toEqual([
      "[Image] Is this swollen?",
      "[Audio message]",
      "[Location] Clinic, Jl. Sudirman",
      "Book now",
      "[Unsupported message: order]",
    ]);
  });
});

describe("parseStatusUpdates", () => {
  it("reads delivery reports", () => {
    expect(parseStatusUpdates(wrap({ statuses: [{ id: "wamid.9", status: "delivered" }] }))).toEqual([
      { messageId: "wamid.9", status: "delivered", detail: null },
    ]);
  });

  it("keeps Meta's reason for a failure", () => {
    const [update] = parseStatusUpdates(
      wrap({
        statuses: [
          {
            id: "wamid.9",
            status: "failed",
            errors: [{ code: 131047, title: "Re-engagement message", error_data: { details: "More than 24 hours have passed." } }],
          },
        ],
      })
    );
    expect(update.status).toBe("failed");
    expect(update.detail).toBe("More than 24 hours have passed. (error 131047)");
  });

  it("ignores unknown statuses and message payloads", () => {
    expect(parseStatusUpdates(wrap({ statuses: [{ id: "wamid.9", status: "deleted" }] }))).toEqual([]);
    expect(parseStatusUpdates(wrap(textMessage("Hello")))).toEqual([]);
  });
});

describe("verifySignature", () => {
  const body = Buffer.from(JSON.stringify({ hello: "world" }));
  const secret = "app-secret";
  const signature = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  it("accepts a signature from Meta", () => {
    expect(verifySignature(body, signature, secret)).toBe(true);
  });

  it("rejects a wrong secret, a tampered body, and a missing or malformed header", () => {
    expect(verifySignature(body, signature, "other-secret")).toBe(false);
    expect(verifySignature(Buffer.from("{}"), signature, secret)).toBe(false);
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, "sha256=abc", secret)).toBe(false);
  });
});
