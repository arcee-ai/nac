/** @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import OriginSessionBadge, {
  OriginSessionKind,
  originKindFromLineage,
  originSessionIconName,
} from "@/app/atoms/origin-session-badge";
import { IconName } from "@/app/atoms/icon";

describe("OriginSessionBadge", () => {
  it.each([
    ["traditional-child", false, OriginSessionKind.TraditionalChild],
    ["managed-orchestrator", false, OriginSessionKind.ManagedOrchestrator],
    [null, true, OriginSessionKind.Fork],
    [undefined, false, undefined],
  ] as const)("maps current lineage %s and fork=%s", (lineage, forked, expected) => {
    expect(originKindFromLineage(lineage, forked)).toBe(expected);
  });

  it("gives current lineage precedence over an independent fork relationship", () => {
    expect(originKindFromLineage("traditional-child", true)).toBe(
      OriginSessionKind.TraditionalChild,
    );
  });

  it.each([
    [OriginSessionKind.Fork, IconName.Scheme],
    [OriginSessionKind.TraditionalChild, IconName.Bolt],
    [OriginSessionKind.ManagedOrchestrator, IconName.Lock],
  ] as const)("maps %s to its origin glyph", (kind, expected) => {
    expect(originSessionIconName(kind)).toBe(expected);
  });

  it("inverts the read-only managed orchestrator badge", () => {
    const { container } = render(
      <OriginSessionBadge kind={OriginSessionKind.ManagedOrchestrator} />,
    );
    const badge = container.firstElementChild;

    expect(badge?.classList.contains("bg-btn-primary")).toBe(true);
    expect(badge?.classList.contains("text-btn-primary")).toBe(true);
    expect(badge?.getAttribute("aria-hidden")).toBe("true");
  });
});
