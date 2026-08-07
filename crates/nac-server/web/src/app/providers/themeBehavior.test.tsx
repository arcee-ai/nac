/// <reference types="node" />

import { readFileSync } from "node:fs";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserMessage } from "@/app/components/inspector/UserMessage";

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");
const primitives = read("../theme/primitives.css");
const lightTheme = read("../theme/light-mode.css");
const darkTheme = read("../theme/dark-mode.css");
const html = read("../../../index.html");

function cssValue(source: string, name: string): string {
  const match = source.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing CSS variable: ${name}`);
  return match[1].trim();
}

function hexForToken(themeCss: string, token: string): string {
  const primitiveName = cssValue(themeCss, token).match(/^var\(--([^)]+)\)$/)?.[1];
  if (!primitiveName) throw new Error(`${token} must reference a primitive`);
  return cssValue(primitives, primitiveName);
}

function luminance(hex: string): number {
  const normalized =
    hex.length === 4
      ? `#${[...hex.slice(1)].map((character) => character.repeat(2)).join("")}`
      : hex;
  const channels = normalized
    .slice(1)
    .match(/.{2}/g)!
    .map((part) => Number.parseInt(part, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

describe("theme bootstrap and message contrast", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
  });

  it("resolves the saved mode before the application module loads", () => {
    const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(bootstrap).toBeTruthy();
    localStorage.setItem("nac-theme", "light");
    const matchMedia = vi.fn(() => ({ matches: true }));

    new Function("localStorage", "matchMedia", "document", bootstrap!)(
      localStorage,
      matchMedia,
      document,
    );

    expect(document.documentElement).toHaveClass("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(matchMedia).not.toHaveBeenCalled();
  });

  it("gives user messages enhanced WCAG contrast in both themes", () => {
    expect(lightTheme).toContain("--color-bg-user-message");
    expect(darkTheme).toContain("--color-bg-user-message");
    for (const [file, theme] of [
      ["light-mode.css", lightTheme],
      ["dark-mode.css", darkTheme],
    ] as const) {
      const background = hexForToken(theme, "color-bg-user-message");
      const foreground = hexForToken(theme, "color-text-user-message");
      expect(contrast(background, foreground), file).toBeGreaterThanOrEqual(7);
    }

    render(<UserMessage text="Readable prompt" pending />);
    expect(screen.getByText("Readable prompt")).toHaveClass(
      "user-message-surface",
    );
  });
});
