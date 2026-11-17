/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { createDockWidth } from "./useDockWidth";

it("persists a finite width and restores it in a new presentation", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  createDockWidth(storage).setDockWidth(700);
  const next = createDockWidth(storage);
  expect(renderHook(() => next.useDockWidth()).result.current).toBe(700);
  next.setDockWidth(Number.NaN);
  expect(values.get("nac-session-dock-width")).toBe("700");
});
