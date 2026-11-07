/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { KvEditor } from "./McpKvEditor";
import type { KvRow } from "@/app/lib/mcpKvRows";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Editor({ secret = true }: { secret?: boolean }) {
  const [rows, setRows] = useState<KvRow[]>([
    { key: "FIRST", value: "private draft" },
    { key: "SECOND", value: "${HOST_TOKEN}" },
  ]);
  return (
    <KvEditor
      label="Environment"
      hint="Stored values are write-only."
      keyPlaceholder="KEY"
      rows={rows}
      onChange={setRows}
      secret={secret}
    />
  );
}

it("masks drafts without changing their exact values and preserves the remaining row on removal", () => {
  render(<Editor />);
  const field = screen.getByLabelText("Environment value 1") as HTMLInputElement;
  expect(field.type).toBe("password");
  fireEvent.change(field, { target: { value: "  exact $VALUE `literal`  " } });
  expect(field.value).toBe("  exact $VALUE `literal`  ");
  fireEvent.click(screen.getByRole("button", { name: "Remove environment entry 1" }));
  expect((screen.getByLabelText("Environment value 1") as HTMLInputElement).value).toBe(
    "${HOST_TOKEN}",
  );
  expect(document.activeElement).toBe(screen.getByLabelText("Environment key 1"));
  fireEvent.click(screen.getByRole("button", { name: "Remove environment entry 1" }));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add entry" }));
  fireEvent.click(screen.getByRole("button", { name: "Add entry" }));
  expect(document.activeElement).toBe(screen.getByLabelText("Environment key 1"));
  expect((screen.getByLabelText("Environment value 1") as HTMLInputElement).value).toBe("");
});

it("keeps environment variable names readable in non-secret mappings", () => {
  render(<Editor secret={false} />);
  expect((screen.getByLabelText("Environment value 1") as HTMLInputElement).type).toBe("text");
});
