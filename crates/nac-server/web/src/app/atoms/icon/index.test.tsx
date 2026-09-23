/** @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Icon, { IconName } from "@/app/atoms/icon";

describe("Icon", () => {
  it("renders every segment of a compound glyph with its fill rule", () => {
    const { container } = render(<Icon iconName={IconName.PlaneAdd} />);
    const paths = container.querySelectorAll("path");

    expect(paths).toHaveLength(2);
    expect(paths[0]?.getAttribute("fill-rule")).toBe("evenodd");
    expect(paths[1]?.getAttribute("fill-rule")).toBe("evenodd");
  });

  it("uses a unique animated gradient for each shimmering icon", () => {
    const { container } = render(
      <>
        <Icon iconName={IconName.Robot} shimmer />
        <Icon iconName={IconName.Orchestrator} shimmer />
      </>,
    );
    const gradients = [...container.querySelectorAll("linearGradient")];
    const paths = [...container.querySelectorAll("path")];

    expect(gradients).toHaveLength(2);
    expect(gradients[0]?.id).not.toBe(gradients[1]?.id);
    expect(container.querySelectorAll("animateTransform")).toHaveLength(2);
    expect(paths[0]?.getAttribute("fill")).toBe(`url(#${gradients[0]?.id})`);
    expect(paths[1]?.getAttribute("fill")).toBe(`url(#${gradients[1]?.id})`);
  });
});
