import { describe, expect, it } from "vitest";

import { toWorkspaceRelativePath } from "@/app/lib/workspaceLink";

describe("toWorkspaceRelativePath", () => {
  it("maps host and relative file paths onto the Files panel", () => {
    expect(toWorkspaceRelativePath("/workspace/src/app.tsx", ["/workspace"])).toBe("src/app.tsx");
    expect(toWorkspaceRelativePath("./src/app.tsx")).toBe("src/app.tsx");
  });

  it("rejects paths that cannot be mapped safely", () => {
    expect(toWorkspaceRelativePath("/outside/src/app.tsx", ["/workspace"])).toBeNull();
    expect(toWorkspaceRelativePath("../secret.txt")).toBeNull();
    expect(toWorkspaceRelativePath("https://example.com/file.ts")).toBeNull();
  });
});
