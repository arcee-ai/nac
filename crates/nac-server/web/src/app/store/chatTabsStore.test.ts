/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";

import { chatTabsStore, setChatTabOrder } from "@/app/store/chatTabsStore";

beforeEach(() => {
  chatTabsStore.setState({ dismissed: new Set(), order: {} });
});

describe("project tab arrangement", () => {
  it("keeps each project's Option A order independent", () => {
    setChatTabOrder("project-a", ["a-2", "a-1"]);
    setChatTabOrder("project-b", ["b-3", "b-1", "b-2"]);

    expect(chatTabsStore.getState().order).toEqual({
      "project-a": ["a-2", "a-1"],
      "project-b": ["b-3", "b-1", "b-2"],
    });
  });
});
