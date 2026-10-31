/** @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it } from "vitest";

import Icon, { IconName } from "./index";

afterEach(cleanup);

const BRAND_ICONS = new Set<IconName>([
  IconName.Arcee,
  IconName.ChatGpt,
  IconName.Discord,
  IconName.Github,
  IconName.Google,
  IconName.Javascript,
  IconName.Python,
]);

function renderIcon(props: ComponentProps<typeof Icon>) {
  const svg = render(<Icon {...props} />).container.querySelector("svg");
  if (!svg) throw new Error("Icon rendered no svg");
  return svg;
}

it.each([...new Set(Object.values(IconName))])("draws %s", (iconName) => {
  const svg = renderIcon({ iconName });
  expect(svg.classList.contains("icon")).toBe(true);
  // A name missing from the Lucide map would fall through to an empty brand path.
  expect(svg.classList.contains("lucide")).toBe(!BRAND_ICONS.has(iconName));
  const shapes = Array.from(svg.children).filter((shape) => shape.getAttribute("d") !== "");
  expect(shapes.length).toBeGreaterThan(0);
});

it.each([IconName.Check, IconName.Github])(
  "hands the color prop of %s to the stylesheet as --icon-color",
  (iconName) => {
    const svg = renderIcon({ iconName, color: "rgb(1, 2, 3)" });
    expect(svg.style.getPropertyValue("--icon-color")).toBe("rgb(1, 2, 3)");
    expect(svg.style.color).toBe("");
  },
);

it("leaves --icon-color unset without a color prop", () => {
  expect(renderIcon({ iconName: IconName.Check }).style.getPropertyValue("--icon-color")).toBe("");
});

it("hides a decorative glyph from assistive technology", () => {
  expect(renderIcon({ iconName: IconName.Check }).getAttribute("aria-hidden")).toBe("true");
});

it("exposes a glyph that carries its own label", () => {
  const svg = renderIcon({ iconName: IconName.Check, role: "img", "aria-label": "Done" });
  expect(svg.hasAttribute("aria-hidden")).toBe(false);
  expect(svg.getAttribute("aria-label")).toBe("Done");
});
