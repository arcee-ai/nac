import { describe, expect, it } from "vitest";

import { bestScore, fuzzyScore } from "./fuzzy";

describe("palette fuzzy matching", () => {
  it("requires every character in order", () => {
    expect(fuzzyScore("mcp", "MCP servers")).not.toBeNull();
    expect(fuzzyScore("msv", "MCP servers")).not.toBeNull();
    expect(fuzzyScore("xyz", "MCP servers")).toBeNull();
    expect(fuzzyScore("pcm", "MCP servers")).toBeNull();
  });

  it("ranks substrings and word starts above scattered matches", () => {
    const exact = fuzzyScore("ser", "MCP servers")!;
    const scattered = fuzzyScore("srs", "MCP servers")!;
    expect(exact).toBeGreaterThan(scattered);
    expect(fuzzyScore("dark", "Dark theme")!).toBeGreaterThan(
      fuzzyScore("dark", "Use a darker look")!,
    );
  });

  it("treats an empty query as a match for everything", () => {
    expect(fuzzyScore("  ", "anything")).toBe(0);
  });

  it("falls back to keywords below a label match", () => {
    expect(bestScore("models", "Models & providers")!).toBeGreaterThan(
      bestScore("models", "Configurations", "models providers")!,
    );
    expect(bestScore("models", "Configurations", "models providers")).not.toBeNull();
    expect(bestScore("zzz", "Configurations", "models")).toBeNull();
  });
});
