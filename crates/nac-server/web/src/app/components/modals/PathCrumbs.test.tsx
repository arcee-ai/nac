/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PathCrumbs } from "./PathCrumbs";

afterEach(cleanup);

it("makes the root and the immediate parent reachable from a home directory", () => {
  const open = vi.fn();
  render(<PathCrumbs path="/home/fixture" home="/home/fixture" onOpen={open} />);
  expect(screen.getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBe(
    "location",
  );
  fireEvent.click(screen.getByRole("button", { name: "home" }));
  fireEvent.click(screen.getByRole("button", { name: "/" }));
  expect(open.mock.calls).toEqual([["/home"], ["/"]]);
});
