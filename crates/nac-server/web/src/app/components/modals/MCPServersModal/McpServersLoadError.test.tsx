/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { McpServersLoadError } from "@/app/components/modals/MCPServersModal/McpServersLoadError";

afterEach(cleanup);

describe("MCP server load recovery", () => {
  it("shows the actionable server error and retries on demand", () => {
    const onRetry = vi.fn();
    render(
      <McpServersLoadError
        error={new Error("remove /tmp/config.toml.nac-preserved to keep canonical")}
        retrying={false}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("MCP servers could not be loaded.")).toBeTruthy();
    expect(screen.getByText(/remove .*nac-preserved/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
