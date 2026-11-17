import { describe, expect, it } from "vitest";

import { bindSelection, sha256Hex } from "./selectionBinding";

describe("sha256Hex", () => {
  it("matches the standard digests, including multi-block and non-ASCII text", async () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    for (const text of ["é — ünïcode 🚀", "x".repeat(55), "y".repeat(56), "z".repeat(1000)]) {
      const digest = await globalThis.crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(text),
      );
      const expected = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      expect(sha256Hex(text)).toBe(expected);
    }
  });
});

describe("bindSelection", () => {
  const source =
    "Use **bold** caching.\n\nThe key is `session_id` — ünïcode.\n\n```rust\nlet x = 1;\n```";

  it("maps plain prose to exact scalar offsets", () => {
    const binding = bindSelection(source, "The key is");
    expect(binding).toEqual({ start: 23, end: 33, excerpt: "The key is" });
  });

  it("skips Markdown markup and normalizes whitespace runs", () => {
    expect(bindSelection(source, "Use bold caching.")?.excerpt).toBe("Use **bold** caching.");
    expect(bindSelection(source, "caching.\nThe key")?.excerpt).toBe("caching.\n\nThe key");
    const unicode = bindSelection(source, "session_id — ünïcode");
    expect(unicode?.excerpt).toBe("session_id` — ünïcode");
    // Offsets count Unicode scalars, not UTF-16 units.
    expect(Array.from(source).slice(unicode!.start, unicode!.end).join("")).toBe(unicode!.excerpt);
  });

  it("maps code exactly and refuses text that is not in the message", () => {
    expect(bindSelection(source, "let x = 1;")?.excerpt).toBe("let x = 1;");
    expect(bindSelection(source, "not in the reply")).toBeNull();
    expect(bindSelection(source, "   ")).toBeNull();
  });

  it("never binds to source the reply does not show as text", () => {
    // Rendered "a-b ab": the selected final "ab" sits 4/6 of the way in, which
    // is nearer the hidden URL's "a-b" than the "ab" itself.
    expect(bindSelection("[a-b](https://example.com/a-b) ab", "ab", 4 / 6)).toEqual({
      start: 31,
      end: 33,
      excerpt: "ab",
    });
    expect(bindSelection("![plot of runs](plot.png) The plot", "plot", 0)?.start).toBe(30);
    expect(bindSelection("<!-- cache --> The cache", "cache", 0)?.start).toBe(19);
    expect(bindSelection("Let $x + y$ be x", "x", 0)?.start).toBe(15);
    // Only hidden copies match: refused rather than guessed.
    const referenced = "See [the docs][guide].\n\n[guide]: https://example.com/guide";
    expect(bindSelection(referenced, "guide", 1)).toBeNull();
    // Code shows its Markdown as typed, so a selection there still binds.
    expect(bindSelection("Use `[x](y)` here", "[x](y)", 0.5)?.excerpt).toBe("[x](y)");
    expect(bindSelection("```\n<b>bold</b>\n```", "<b>bold</b>", 0.5)?.start).toBe(4);
  });

  it("prefers the occurrence nearest to where the selection was made", () => {
    const repeated = "same words here. same words here.";
    expect(bindSelection(repeated, "same words", 0)?.start).toBe(0);
    expect(bindSelection(repeated, "same words", 1)?.start).toBe(17);
  });
});
