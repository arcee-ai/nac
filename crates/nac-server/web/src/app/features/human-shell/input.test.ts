import { describe, expect, it } from "vitest";
import { shellInput } from "./input";

describe("human shell syntax", () => {
  it("preserves every byte after the leading bang", () => {
    expect(shellInput("!  printf 'a b'\n\t")).toEqual({
      kind: "command",
      command: "  printf 'a b'\n\t",
    });
    expect(shellInput("!")).toEqual({ kind: "command", command: "" });
  });
  it("escapes a literal bang and does not reinterpret leading whitespace", () => {
    expect(shellInput("\\!literal")).toEqual({ kind: "prompt", prompt: "!literal" });
    expect(shellInput(" !literal")).toEqual({ kind: "prompt", prompt: " !literal" });
    expect(shellInput("/skill !literal")).toEqual({ kind: "prompt", prompt: "/skill !literal" });
  });
});
