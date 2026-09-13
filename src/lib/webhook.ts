import { createHmac, timingSafeEqual } from "node:crypto";

export interface IncomingMessage {
  /** WhatsApp message ID (wamid), used to ignore redeliveries */
  id: string;
  /** Sender's phone number */
  from: string;
  /** Sender's WhatsApp profile name */
  name: string | null;
  /** Text stored in the conversation and sent to the AI */
  text: string;
}

interface WebhookMessage {
  id: string;
  from: string;
  type: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
}

export interface WebhookPayload {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: WebhookMessage[];
      };
    }[];
  }[];
}

/** Checks Meta's X-Hub-Signature-256 header: an HMAC-SHA256 of the raw request body keyed with the app secret. */
export function verifySignature(rawBody: Buffer, signatureHeader: string | null, appSecret: string): boolean {
  const prefix = "sha256=";
  if (!signatureHeader?.startsWith(prefix)) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const received = Buffer.from(signatureHeader.slice(prefix.length), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * Extracts customer messages from a webhook payload. Status updates (sent, delivered, read)
 * and events with nothing to show, such as reactions, are skipped. When `phoneNumberId` is
 * given, messages sent to other phone numbers on the same WhatsApp Business Account are ignored.
 */
export function parseWebhookPayload(payload: WebhookPayload | null, phoneNumberId?: string): IncomingMessage[] {
  if (payload?.object !== "whatsapp_business_account") return [];

  const messages: IncomingMessage[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages) continue;

      const recipient = value.metadata?.phone_number_id;
      if (phoneNumberId && recipient && recipient !== phoneNumberId) continue;

      const contacts = value.contacts ?? [];
      for (const message of value.messages) {
        const text = describeMessage(message);
        if (!text) continue;

        const contact = contacts.find((c) => c.wa_id === message.from) ?? (contacts.length === 1 ? contacts[0] : undefined);
        messages.push({ id: message.id, from: message.from, name: contact?.profile?.name || null, text });
      }
    }
  }
  return messages;
}

/** Text to store for a message. Non-text messages get a placeholder such as "[Image] caption". */
function describeMessage(message: WebhookMessage): string | null {
  switch (message.type) {
    case "text":
      return message.text?.body || null;
    case "button":
      return message.button?.text || null;
    case "interactive":
      return message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || null;
    case "image":
      return withCaption("[Image]", message.image?.caption);
    case "video":
      return withCaption("[Video]", message.video?.caption);
    case "document":
      return withCaption("[Document]", message.document?.caption || message.document?.filename);
    case "audio":
      return "[Audio message]";
    case "sticker":
      return "[Sticker]";
    case "location": {
      const { name, address, latitude, longitude } = message.location ?? {};
      return `[Location] ${[name, address].filter(Boolean).join(", ") || `${latitude}, ${longitude}`}`;
    }
    case "contacts":
      return "[Contact card]";
    case "reaction":
    case "system":
    case "request_welcome":
      return null;
    default:
      return `[Unsupported message: ${message.type}]`;
  }
}

function withCaption(label: string, caption: string | undefined): string {
  return caption ? `${label} ${caption}` : label;
}
