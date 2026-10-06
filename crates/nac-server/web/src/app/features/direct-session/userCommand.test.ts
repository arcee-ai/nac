import { describe, expect, it, vi } from "vitest";

import { runCommand, runUserCommand } from "./commandWorkflow";
import { parseComposerInput } from "./userCommand";

describe("parseComposerInput", () => {
  it("preserves every byte after the command marker", () => {
    expect(parseComposerInput("!  ls -la \n", true)).toEqual({
      kind: "command",
      command: "  ls -la \n",
    });
    expect(parseComposerInput("!echo a\n  echo  b\t", true)).toEqual({
      kind: "command",
      command: "echo a\n  echo  b\t",
    });
  });

  it("keeps bare and indented bangs as ordinary prompts", () => {
    expect(parseComposerInput("!", true)).toEqual({ kind: "prompt", prompt: "!" });
    expect(parseComposerInput("!   \n", true)).toEqual({ kind: "prompt", prompt: "!" });
    expect(parseComposerInput("  !ls", true)).toEqual({ kind: "prompt", prompt: "!ls" });
  });

  it("sends an escaped bang as a literal prompt", () => {
    expect(parseComposerInput("\\!ls", true)).toEqual({ kind: "prompt", prompt: "!ls" });
  });

  it("recognizes and rejects shell intent outside a direct primary chat", () => {
    expect(parseComposerInput("!ls", false)).toEqual({
      kind: "unsupported-command",
      command: "ls",
    });
    expect(parseComposerInput("\\!ls", false)).toEqual({ kind: "prompt", prompt: "!ls" });
  });
});

describe("runUserCommand", () => {
  it("returns an accepted admission without a lookup", async () => {
    const admit = vi.fn(async () => ({ kind: "accepted" as const, value: "snapshot" }));
    const lookup = vi.fn(async () => "looked-up");
    expect(await runCommand(runUserCommand({ admit, lookup }))).toBe("snapshot");
    expect(admit).toHaveBeenCalledOnce();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("fails a not-sent admission without a lookup", async () => {
    const error = new Error("not sent");
    const admit = vi.fn(async () => ({ kind: "not-sent" as const, error }));
    const lookup = vi.fn(async () => "looked-up");
    await expect(runCommand(runUserCommand({ admit, lookup }))).rejects.toBe(error);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("settles an uncertain admission by looking up the same request id once", async () => {
    const admit = vi.fn(async () => ({
      kind: "uncertain" as const,
      requestId: "req-1",
      error: new Error("lost"),
    }));
    const lookup = vi.fn(async () => "looked-up");
    expect(await runCommand(runUserCommand({ admit, lookup }))).toBe("looked-up");
    expect(admit).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledExactlyOnceWith("req-1");
  });

  it("keeps the uncertain error when the lookup finds nothing", async () => {
    const error = new Error("lost");
    const admit = vi.fn(async () => ({ kind: "uncertain" as const, requestId: "req-1", error }));
    const lookup = vi.fn(async () => {
      throw new Error("404");
    });
    await expect(runCommand(runUserCommand({ admit, lookup }))).rejects.toBe(error);
    expect(admit).toHaveBeenCalledOnce();
  });

  it("surfaces a rejected admission such as busy", async () => {
    const busy = new Error("session is busy (HTTP 409)");
    const admit = vi.fn(async () => {
      throw busy;
    });
    const lookup = vi.fn(async () => "looked-up");
    await expect(runCommand(runUserCommand({ admit, lookup }))).rejects.toBe(busy);
    expect(lookup).not.toHaveBeenCalled();
  });
});
