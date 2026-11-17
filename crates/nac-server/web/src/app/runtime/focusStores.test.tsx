/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { createPresentationStores, releasePresentationStores } from "./presentationStores";

afterEach(cleanup);

it("isolates Home drafts, palette/sidebar commands, Inbox reads and density between presentations", () => {
  const left = createPresentationStores();
  const right = createPresentationStores();
  let toggles = 0;
  right.commandSurfaceStore.registerSidebarToggle(() => toggles++);
  const probe = renderHook(() => ({
    left: left.commandSurfaceStore.useCommandSurface(),
    right: right.commandSurfaceStore.useCommandSurface(),
    leftDensity: left.transcriptDensityStore.useTranscriptDensity(),
    rightDensity: right.transcriptDensityStore.useTranscriptDensity(),
  }));
  act(() => {
    left.commandSurfaceStore.openCommandPalette();
    left.transcriptDensityStore.setTranscriptDensity("detailed");
  });
  expect(probe.result.current).toEqual({
    left: "palette",
    right: null,
    leftDensity: "detailed",
    rightDensity: "compact",
  });
  expect(left.commandSurfaceStore.requestSidebarToggle()).toBe(false);
  expect(toggles).toBe(0);
  expect(right.commandSurfaceStore.requestSidebarToggle()).toBe(true);
  expect(toggles).toBe(1);
  left.homeDraftStore.update("private unsent text");
  left.inboxReadStore.markRead("same-id", "run");
  left.inboxReadStore.firstSeen.set("request", 1);
  expect(right.homeDraftStore.get().text).toBe("");
  expect(right.inboxReadStore.getState().runs).toEqual({});
  expect(right.inboxReadStore.firstSeen.size).toBe(0);
  const revision = left.homeDraftStore.get().revision;
  left.homeDraftStore.update("newer text");
  left.homeDraftStore.acknowledge(revision);
  expect(left.homeDraftStore.get().text).toBe("newer text");
  act(() => releasePresentationStores(left));
  left.homeDraftStore.update("late callback");
  left.inboxReadStore.markRead("late", "run");
  act(() => left.commandSurfaceStore.openCommandPalette());
  expect(left.homeDraftStore.get().text).toBe("");
  expect(left.inboxReadStore.getState().runs).toEqual({});
  expect(left.inboxReadStore.firstSeen.size).toBe(0);
  expect(probe.result.current.left).toBeNull();
  releasePresentationStores(right);
});

it("restores device reads and density only through the supplied durable preference namespace", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
  const old = createPresentationStores(storage);
  old.inboxReadStore.markRead("session", "run");
  old.transcriptDensityStore.setTranscriptDensity("detailed");
  old.sidebarLayoutStore.setView("inbox");
  old.sidebarLayoutStore.toggleProjectCollapsed("project");
  old.homeDraftStore.update("not a durable preference");
  releasePresentationStores(old);
  const replacement = createPresentationStores(storage);
  const probe = renderHook(() => ({
    density: replacement.transcriptDensityStore.useTranscriptDensity(),
    view: replacement.sidebarLayoutStore.useView(),
    collapsed: replacement.sidebarLayoutStore.useCollapsedProjects(),
  }));
  expect(probe.result.current).toEqual({
    density: "detailed",
    view: "inbox",
    collapsed: ["project"],
  });
  expect(replacement.inboxReadStore.getState().runs).toEqual({ session: "run" });
  expect(replacement.homeDraftStore.get().text).toBe("");
  releasePresentationStores(replacement);
});
