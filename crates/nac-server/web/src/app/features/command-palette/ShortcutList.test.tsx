/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { NativeMenuContext } from "@/app/features/desktop-commands/nativeMenu";

import { ShortcutList } from "./ShortcutList";

afterEach(cleanup);

it("lists one New session chord in a browser and no project-creation shortcut", () => {
  render(<ShortcutList />);
  expect(screen.getByText("New session (in the current project)")).toBeTruthy();
  expect(screen.queryByText(/app menu/)).toBeNull();
  expect(screen.queryByText(/new project/i)).toBeNull();
});

it("adds the native menu's New session only where the native menu exists", () => {
  render(
    <NativeMenuContext.Provider value>
      <ShortcutList />
    </NativeMenuContext.Provider>,
  );
  expect(screen.getByText("New session (in the current project)")).toBeTruthy();
  expect(screen.getByText("New session (app menu)")).toBeTruthy();
});
