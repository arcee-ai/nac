/** @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SessionTypeAvatar, { sessionTypeIconName } from "@/app/atoms/session-type-avatar";
import { IconName } from "@/app/atoms/icon";

describe("SessionTypeAvatar", () => {
  it.each([
    ["orchestrator", IconName.Orchestrator],
    ["direct", IconName.Plane],
    ["direct-with-orchestrator", IconName.PlaneAdd],
  ] as const)("maps %s to its identity glyph", (behavior, expected) => {
    expect(sessionTypeIconName(behavior)).toBe(expected);
  });

  it("keeps the legacy omitted behavior default and applies running shimmer locally", () => {
    const { container } = render(<SessionTypeAvatar running />);
    const avatar = container.firstElementChild;

    expect(sessionTypeIconName()).toBe(IconName.Orchestrator);
    expect(avatar?.classList.contains("session-type-avatar-shimmer")).toBe(true);
    expect(avatar?.getAttribute("aria-hidden")).toBe("true");
  });
});
