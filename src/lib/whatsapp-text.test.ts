import { describe, expect, it } from "vitest";
import { splitMessage, toWhatsAppFormat, WHATSAPP_TEXT_LIMIT } from "@/lib/whatsapp-text";

describe("toWhatsAppFormat", () => {
  it("converts Markdown emphasis to WhatsApp's syntax", () => {
    expect(toWhatsAppFormat("**Bold** and ~~strike~~")).toBe("*Bold* and ~strike~");
    expect(toWhatsAppFormat("## Opening hours")).toBe("*Opening hours*");
    expect(toWhatsAppFormat("### **Opening hours** ##")).toBe("*Opening hours*");
  });

  it("removes reasoning blocks some models emit", () => {
    expect(toWhatsAppFormat("<think>plan the reply</think>\nHello!")).toBe("Hello!");
  });

  it("flattens links and code fences", () => {
    expect(toWhatsAppFormat("See [our site](https://x.com/a)")).toBe("See our site (https://x.com/a)");
    expect(toWhatsAppFormat("[https://x.com](https://x.com)")).toBe("https://x.com");
    expect(toWhatsAppFormat("```ts\nconst a = 1;\n```")).toBe("```\nconst a = 1;\n```");
  });

  it("leaves lists, maths and hashtags alone", () => {
    expect(toWhatsAppFormat("* one\n- two")).toBe("* one\n- two");
    expect(toWhatsAppFormat("2*3*4 #tag")).toBe("2*3*4 #tag");
  });

  it("collapses runs of blank lines", () => {
    expect(toWhatsAppFormat("a\n\n\n\nb")).toBe("a\n\nb");
  });
});

describe("splitMessage", () => {
  it("leaves short text as one message and drops empty text", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
    expect(splitMessage("   ")).toEqual([]);
  });

  it("keeps every chunk within WhatsApp's limit without losing words", () => {
    const words = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(" ");
    const chunks = splitMessage(words);
    expect(chunks.every((chunk) => chunk.length <= WHATSAPP_TEXT_LIMIT)).toBe(true);
    expect(chunks.join(" ")).toBe(words);
  });

  it("prefers a paragraph boundary", () => {
    const chunks = splitMessage("x".repeat(3000) + "\n\n" + "y".repeat(2000));
    expect(chunks.map((chunk) => chunk.length)).toEqual([3000, 2000]);
  });

  it("hard-cuts text with no break, without splitting an emoji", () => {
    expect(splitMessage("a".repeat(5000)).map((chunk) => chunk.length)).toEqual([4096, 904]);
    expect(splitMessage("a".repeat(4095) + "\u{1F600}b").map((chunk) => chunk.length)).toEqual([4095, 3]);
  });
});
