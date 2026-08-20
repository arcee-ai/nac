import { describe, expect, it } from "vitest";

import {
  highlightCode,
  highlightDiff,
  highlightSource,
  languageFromPath,
  tokenStyle,
  type CodeToken,
} from "@/app/lib/highlight";
import type { WorkspaceDiffLine, WorkspaceDiffSection } from "@/app/types/api";

function flatten(lines: CodeToken[][]): string {
  return lines.map((line) => line.map((token) => token.text).join("")).join("\n");
}

function colorsOf(lines: CodeToken[][]): string[] {
  return [
    ...new Set(
      lines.flatMap((line) => line.flatMap((token) => (token.color ? [token.color] : []))),
    ),
  ];
}

function line(kind: WorkspaceDiffLine["kind"], content: string): WorkspaceDiffLine {
  return {
    kind,
    old_lineno: kind === "insert" ? null : 1,
    new_lineno: kind === "delete" ? null : 1,
    content,
    has_trailing_newline: true,
  };
}

function section(lines: WorkspaceDiffLine[]): WorkspaceDiffSection[] {
  return [
    {
      stage: "unstaged",
      status: "modified",
      binary: false,
      too_large: false,
      truncated: false,
      additions: lines.filter(({ kind }) => kind === "insert").length,
      deletions: lines.filter(({ kind }) => kind === "delete").length,
      error: null,
      hunks: [
        {
          old_start: 1,
          old_lines: lines.filter(({ kind }) => kind !== "insert").length,
          new_start: 1,
          new_lines: lines.filter(({ kind }) => kind !== "delete").length,
          function_context: null,
          lines,
        },
      ],
    },
  ];
}

describe("languageFromPath", () => {
  it("maps common extensions onto Shiki language ids", () => {
    expect(languageFromPath("src/main.rs")).toBe("rust");
    expect(languageFromPath("app.ts")).toBe("typescript");
    expect(languageFromPath("app.tsx")).toBe("typescript");
    expect(languageFromPath("index.py")).toBe("python");
    expect(languageFromPath("page.html")).toBe("html");
    expect(languageFromPath("icon.svg")).toBe("xml");
    expect(languageFromPath("Cargo.toml")).toBe("toml");
    expect(languageFromPath("config.ini")).toBe("ini");
    expect(languageFromPath("changes.diff")).toBe("diff");
    expect(languageFromPath("changes.patch")).toBe("diff");
    expect(languageFromPath("CHANGES.DIFF")).toBe("diff");
    expect(languageFromPath("CHANGES.PATCH")).toBe("diff");
  });

  it("returns null when the extension is unknown", () => {
    expect(languageFromPath("notes.unknownext")).toBeNull();
    expect(languageFromPath("Makefile")).toBeNull();
  });
});

describe("highlightSource", () => {
  it("returns null for unknown or plain fence languages", async () => {
    expect(await highlightSource("plaintext", "hello")).toBeNull();
    expect(await highlightSource("text", "hello")).toBeNull();
    expect(await highlightSource("console", "hello")).toBeNull();
    expect(await highlightSource("not-a-language", "hello")).toBeNull();
  });

  it("tokenises javascript so the tokens reconstruct the source", async () => {
    const source = 'const n = 1;\nconst s = "hi";\n';
    const lines = await highlightSource("javascript", source);
    expect(lines).not.toBeNull();
    expect(flatten(lines ?? [])).toBe(source);
  });

  it("accepts fence aliases such as js and ts", async () => {
    const source = "const n = 1;";
    const fromAlias = await highlightSource("js", source);
    const fromId = await highlightSource("javascript", source);
    expect(fromAlias).not.toBeNull();
    expect(fromId).not.toBeNull();
    expect(flatten(fromAlias ?? [])).toBe(source);
    expect(flatten(fromId ?? [])).toBe(source);
  });

  it("emits CSS-variable colours from the nac theme", async () => {
    const lines = await highlightSource("javascript", "const n = 1; // c\n");
    expect(lines).not.toBeNull();
    const colors = colorsOf(lines ?? []);
    expect(colors.length).toBeGreaterThan(0);
    for (const color of colors) {
      expect(color).toMatch(/^var\(--color-text-/);
    }
  });

  it("marks comments italic", async () => {
    const lines = await highlightSource("javascript", "// silent\n");
    const tokens = lines?.flat() ?? [];
    expect(tokens.some((token) => token.italic && token.text.includes("silent"))).toBe(true);
  });

  it("reuses a cached result for the same language and source", async () => {
    const source = "fn main() {}";
    const first = await highlightSource("rust", source);
    const second = await highlightSource("rust", source);
    expect(second).toBe(first);
  });

  it("highlights md fences as markdown and bash/toml by their grammar ids", async () => {
    const markdown = await highlightSource("md", "# Title\n");
    const bash = await highlightSource("bash", "echo hi\n");
    const toml = await highlightSource("toml", 'name = "nac"\n');
    const diff = await highlightSource("diff", "-old\n+new\n");
    expect(flatten(markdown ?? [])).toBe("# Title\n");
    expect(flatten(bash ?? [])).toBe("echo hi\n");
    expect(flatten(toml ?? [])).toBe('name = "nac"\n');
    expect(flatten(diff ?? [])).toBe("-old\n+new\n");
    expect(colorsOf(toml ?? []).some((color) => color.includes("success"))).toBe(true);
  });
});

describe("highlightCode", () => {
  it("colours a typescript file by path", async () => {
    const source = "export const x: number = 1;";
    const lines = await highlightCode("src/lib.ts", source);
    expect(lines).not.toBeNull();
    expect(flatten(lines ?? [])).toBe(source);
    expect(colorsOf(lines ?? []).some((color) => color?.includes("accent"))).toBe(true);
  });

  it.each(["diff", "patch"] as const)("colours and reconstructs a .%s file", async (extension) => {
    const source = "-old\n+new\n";
    const lines = await highlightCode(`changes.${extension}`, source);

    expect(lines).not.toBeNull();
    expect(flatten(lines ?? [])).toBe(source);
    expect(colorsOf([lines?.[0] ?? []])).toContain("var(--color-text-error-primary)");
    expect(colorsOf([lines?.[1] ?? []])).toContain("var(--color-text-success-primary)");
  });

  it("returns null for a non-empty file with an unknown extension", async () => {
    expect(await highlightCode("changes.unknownext", "-old\n+new\n")).toBeNull();
  });
});

describe("highlightDiff", () => {
  it("highlights old and new sides independently and keys by line object", async () => {
    const deleted = line("delete", "const a = 1;");
    const context = line("context", "const b = 2;");
    const inserted = line("insert", "const c = 3;");
    const sections = section([deleted, context, inserted]);

    const highlighted = await highlightDiff("src/app.ts", sections);
    expect(highlighted.get(deleted)?.length).toBeGreaterThan(0);
    expect(highlighted.get(context)?.length).toBeGreaterThan(0);
    expect(highlighted.get(inserted)?.length).toBeGreaterThan(0);
    expect(
      highlighted
        .get(deleted)
        ?.map((token) => token.text)
        .join(""),
    ).toBe(deleted.content);
    expect(
      highlighted
        .get(inserted)
        ?.map((token) => token.text)
        .join(""),
    ).toBe(inserted.content);
  });

  it.each(["diff", "patch"] as const)(
    "colours and reconstructs .%s file diff lines",
    async (extension) => {
      const deleted = line("delete", "-old");
      const inserted = line("insert", "+new");
      const highlighted = await highlightDiff(`changes.${extension}`, section([deleted, inserted]));
      const deletedTokens = highlighted.get(deleted);
      const insertedTokens = highlighted.get(inserted);

      expect(deletedTokens?.map(({ text }) => text).join("")).toBe(deleted.content);
      expect(insertedTokens?.map(({ text }) => text).join("")).toBe(inserted.content);
      expect(colorsOf([deletedTokens ?? []])).toContain("var(--color-text-error-primary)");
      expect(colorsOf([insertedTokens ?? []])).toContain("var(--color-text-success-primary)");
    },
  );

  it("returns an empty map for non-empty input with an unknown path extension", async () => {
    const highlighted = await highlightDiff("notes.unknownext", section([line("context", "-old")]));
    expect(highlighted.size).toBe(0);
  });
});

describe("tokenStyle", () => {
  it("maps colour and font flags onto a CSS style object", () => {
    expect(
      tokenStyle({ text: "fn", color: "var(--color-text-accent-primary)", italic: true }),
    ).toEqual({
      color: "var(--color-text-accent-primary)",
      fontStyle: "italic",
      fontWeight: undefined,
    });
  });
});
