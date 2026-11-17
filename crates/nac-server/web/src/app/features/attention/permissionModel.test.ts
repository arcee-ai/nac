import { describe, expect, it } from "vitest";

import type { PermissionRequest } from "@/app/types/api";

import {
  alwaysAllowLabel,
  presentPermission,
  readableScope,
  rememberedScopes,
} from "./permissionModel";

function request(resources: PermissionRequest["resources"], tool = "tool"): PermissionRequest {
  return { id: "r", session_id: "s", tool, created_at_epoch_ms: 1, resources };
}

describe("permission presentation", () => {
  it("leads a command with the command and keeps every other resource", () => {
    const presentation = presentPermission(
      request([
        { action: "execute", resource: "command:[rg]", display: "rg needle" },
        { action: "execute_broad", resource: "command:[rg]", display: "broad authority: rg" },
        { action: "execute_cwd", resource: "/repo", display: "/repo" },
      ]),
    );
    expect(presentation.title).toBe("Run this command?");
    expect(presentation.command).toBe(true);
    expect(presentation.primary.map((resource) => resource.display)).toEqual(["rg needle"]);
    expect(presentation.secondary.map((resource) => resource.action)).toEqual([
      "execute_broad",
      "execute_cwd",
    ]);
  });

  it.each([
    ["edit", "Edit file?"],
    ["read", "Read file?"],
    ["grep", "Search files?"],
    ["terminal_input", "Send this to the terminal?"],
    ["external_directory", "Work outside the workspace?"],
    ["mcp_call", "Use tool?"],
    ["something_new", "Use tool?"],
  ])("asks about %s as %s", (action, title) => {
    const presentation = presentPermission(request([{ action, resource: "x", display: "x" }]));
    expect(presentation.title).toBe(title);
    expect([...presentation.primary, ...presentation.secondary]).toHaveLength(1);
  });

  it("names exactly the grants an always reply stores", () => {
    const scopes = rememberedScopes(
      request([
        { action: "execute", resource: "a", display: "a", save_resource: "command:[git][status]*" },
        { action: "execute_cwd", resource: "/r", display: "/r" },
      ]),
    );
    expect(scopes).toEqual([{ action: "execute", scope: "command:[git][status]*" }]);
    expect(alwaysAllowLabel(scopes)).toBe("Always allow git status *");
    expect(alwaysAllowLabel([])).toBe("Always allow");
  });

  it("reads stored command patterns without paraphrasing anything else", () => {
    expect(readableScope("command:[npm][run][a%20b]*")).toBe("npm run a b *");
    expect(readableScope("command:[ls]")).toBe("ls");
    expect(readableScope("/tmp/outside")).toBe("/tmp/outside");
    expect(readableScope("opaque:sha256:abc")).toBe("opaque:sha256:abc");
  });
});
