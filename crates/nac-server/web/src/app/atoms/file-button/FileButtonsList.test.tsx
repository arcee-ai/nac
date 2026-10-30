/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import FileButtonsList from "./FileButtonsList";

afterEach(cleanup);

it("hands reveal focus past a disabled file", () => {
  render(
    <FileButtonsList
      files={[{ path: "one.ts" }, { path: "two.ts", disabled: true }, { path: "three.ts" }]}
      limit={2}
      onOpen={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "+2 more" }));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "three.ts" }));
});

it("keeps reveal focus in the list when all revealed files are disabled", () => {
  render(
    <FileButtonsList
      aria-label="Changed files"
      files={[
        { path: "one.ts" },
        { path: "two.ts", disabled: true },
        { path: "three.ts", disabled: true },
      ]}
      limit={2}
      onOpen={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "+2 more" }));
  expect(document.activeElement).toBe(screen.getByRole("list", { name: "Changed files" }));
});
