/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Execute the native fixture's exact probe; this models DOM geometry, not native pixels.
const { readFileSync } = await vi.importActual<{
  readFileSync(path: string, encoding: "utf8"): string;
}>("node:fs");
const swift = readFileSync("../../../desktop/macos/StartupSmoke.swift", "utf8");
const script = swift.match(
  /static let configuredPaintReadinessScript = #"""\n([\s\S]*?)\n {4}"""#/,
)!;
const ready = new Function("expectedAnswer", "expectedSessionID", script[1]) as (
  answer: string,
  session: string,
) => boolean;
const answer = "Finder configured local response.";

beforeEach(() => {
  window.location.hash = "#/session/owned/insights";
  document.body.innerHTML = `<style>*{opacity:1;visibility:visible}</style><main data-nac-runtime><p>${answer}</p></main>`;
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.closest("[data-zero]")) return new DOMRect(10, 10, 0, 0);
      if (this.closest("[data-outside]")) return new DOMRect(window.innerWidth + 1, 10, 300, 40);
      return new DOMRect(10, 100, 300, 40);
    },
  );
  delete (window as unknown as Record<string, unknown>).__startupReloading;
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>).__startupReloading;
});

it("accepts exactly one visible configured answer without mutating the document", () => {
  const before = document.body.innerHTML;
  expect(ready(answer, "owned")).toBe(true);
  expect(document.body.innerHTML).toBe(before);
});

it.each([
  [
    "loading conversation",
    () =>
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div aria-label="Loading conversation"></div>',
      ),
  ],
  [
    "faded ancestor",
    () => {
      document.querySelector("main")!.style.opacity = "0";
    },
  ],
  [
    "partly faded ancestor",
    () => {
      document.querySelector("main")!.style.opacity = ".5";
    },
  ],
  ["hidden ancestor", () => document.querySelector("main")!.setAttribute("hidden", "")],
  ["inert ancestor", () => document.querySelector("main")!.setAttribute("inert", "")],
  [
    "aria-hidden ancestor",
    () => document.querySelector("main")!.setAttribute("aria-hidden", "true"),
  ],
  ["zero geometry", () => document.querySelector("p")!.setAttribute("data-zero", "")],
  ["outside viewport", () => document.querySelector("p")!.setAttribute("data-outside", "")],
  [
    "wrong answer",
    () => {
      document.querySelector("p")!.textContent = "Another answer";
    },
  ],
  [
    "duplicate answer",
    () => document.querySelector("main")!.insertAdjacentHTML("beforeend", `<p>${answer}</p>`),
  ],
  [
    "ambiguous runtime",
    () => document.body.insertAdjacentHTML("beforeend", "<main data-nac-runtime></main>"),
  ],
] as const)("rejects %s", (_, mutate) => {
  mutate();
  expect(ready(answer, "owned")).toBe(false);
});

it("rejects the departing document and a different session", () => {
  (window as unknown as Record<string, unknown>).__startupReloading = true;
  expect(ready(answer, "owned")).toBe(false);
  delete (window as unknown as Record<string, unknown>).__startupReloading;
  expect(ready(answer, "another-session")).toBe(false);
});

it("rejects hidden documents without treating an old answer as painted", () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  expect(ready(answer, "owned")).toBe(false);
});
