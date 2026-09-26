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

/** Delivery report for a message we sent. Mirrors MessageStatus in lib/types. */
export interface StatusUpdate {
  /** WhatsApp ID of the message the report is about */
  messageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  /** Why a failed message failed, when Meta says */
  detail: string | null;
}

const DELIVERY_STATUSES = new Set(["sent", "delivered", "read", "failed"]);

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

interface WebhookError {
  code?: number;
  title?: string;
  message?: string;
  error_data?: { details?: string };
}

interface WebhookStatus {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: WebhookError[];
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
        statuses?: WebhookStatus[];
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
 * Extracts customer messages from a webhook payload. Delivery reports and events with
 * nothing to show, such as reactions, are skipped. When `phoneNumberId` is given,
 * messages sent to other phone numbers on the same WhatsApp Business Account are ignored.
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

/**
 * Extracts delivery reports (sent, delivered, read, failed) for messages we sent.
 * Meta reports some failures here rather than when the message is accepted, so this is
 * the only way to know a reply never arrived.
 */
export function parseStatusUpdates(payload: WebhookPayload | null): StatusUpdate[] {
  if (payload?.object !== "whatsapp_business_account") return [];

  const updates: StatusUpdate[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const status of change.value?.statuses ?? []) {
        if (!status.id || !status.status || !DELIVERY_STATUSES.has(status.status)) continue;
        updates.push({
          messageId: status.id,
          status: status.status as StatusUpdate["status"],
          detail: describeError(status.errors),
        });
      }
    }
  }
  return updates;
}

function describeError(errors: WebhookError[] | undefined): string | null {
  const error = errors?.[0];
  if (!error) return null;

  const text = error.error_data?.details || error.message || error.title;
  if (!text) return null;
  return error.code ? `${text} (error ${error.code})` : text;
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
