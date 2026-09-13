/** WhatsApp rejects text message bodies longer than this. */
export const WHATSAPP_TEXT_LIMIT = 4096;

/**
 * Converts the Markdown that models typically produce into WhatsApp's own formatting
 * (*bold*, ~strikethrough~, plain links) and removes what WhatsApp would print literally.
 */
export function toWhatsAppFormat(text: string): string {
  return (
    text
      // Reasoning blocks that some models include in their output
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      // **bold** -> *bold*
      .replace(/\*\*(\S(?:.*?\S)?)\*\*/g, "*$1*")
      // ~~strike~~ -> ~strike~
      .replace(/~~(\S(?:.*?\S)?)~~/g, "~$1~")
      // ## Heading -> *Heading*
      .replace(/^#{1,6}[ \t]+(.+?)[ \t#]*$/gm, (_, heading: string) => `*${heading.replace(/\*/g, "")}*`)
      // [label](url) -> label (url)
      .replace(/!?\[([^\]]+)\]\((\S+?)\)/g, (_, label: string, url: string) =>
        label === url ? url : `${label} (${url})`
      )
      // ```ts -> ``` (WhatsApp would print the language name)
      .replace(/```[\w+-]+\n/g, "```\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Splits text into WhatsApp-sized chunks, breaking at a paragraph, line or word boundary when possible. */
export function splitMessage(text: string, limit = WHATSAPP_TEXT_LIMIT): string[] {
  const chunks: string[] = [];
  let rest = text.trim();

  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    let cut =
      ["\n\n", "\n", " "]
        .map((separator) => window.lastIndexOf(separator))
        .find((index) => index > limit / 2) ?? limit;
    // Don't split an emoji (surrogate pair) in half
    if (cut === limit && /[\uD800-\uDBFF]/.test(rest[cut - 1])) cut -= 1;

    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }

  if (rest) chunks.push(rest);
  return chunks;
}
