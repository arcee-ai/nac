import fs from "node:fs/promises";
import { expect, type Page } from "@playwright/test";

type Rect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};
type ReadingEvent = { type: string; isTrusted: boolean; deltaY?: number; scrollTop?: number };
type Node = {
  parentElement: Node | null;
  clientLeft: number;
  clientTop: number;
  clientWidth: number;
  clientHeight: number;
  scrollTop: number;
  scrollHeight: number;
  className: string;
  tagName: string;
  getBoundingClientRect: () => Rect;
  contains: (node: unknown) => boolean;
  closest: (selector: string) => Node | null;
  querySelector: (selector: string) => Node | null;
  addEventListener: (
    type: string,
    callback: (event: { isTrusted: boolean; deltaY: number }) => void,
    options: object,
  ) => void;
};
type View = {
  innerWidth: number;
  innerHeight: number;
  getComputedStyle: (node: Node) => { overflowX: string; overflowY: string; position: string };
  requestAnimationFrame: (callback: () => void) => void;
  document: {
    elementFromPoint: (x: number, y: number) => unknown;
    createRange: () => {
      selectNodeContents: (node: unknown) => void;
      getClientRects: () => ArrayLike<Rect>;
    };
  };
  __nacInspectorReading?: { events: ReadingEvent[]; scroller: Node };
};

/** Reads back from the preserved bottom-follow state; never forces DOM scroll position. */
export async function assertInspectorReadable(
  page: Page,
  outputPath: (name: string) => string,
  name: string,
  allowGesture: boolean,
  zoom: number,
) {
  const paragraph = page
    .getByRole("dialog", { name: "Subagents", exact: true })
    .getByText("The child inspected the captured changes. No files were modified.", {
      exact: true,
    });
  const composer = page
    .locator("form")
    .filter({ has: page.getByRole("switch", { name: "Run in the background" }) });
  const measure = async (install = false) => {
    const composerRect = await composer.evaluate((raw) => {
      const r = raw.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    });
    return paragraph.evaluate(
      (raw, { composerRect, install }) => {
        const e = raw as unknown as Node;
        const view = globalThis as unknown as View;
        const box = (node: Node): Rect => {
          const r = node.getBoundingClientRect();
          return {
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            width: r.width,
            height: r.height,
          };
        };
        let scroll = e.parentElement;
        while (scroll && !["auto", "scroll"].includes(view.getComputedStyle(scroll).overflowY))
          scroll = scroll.parentElement;
        if (!scroll) throw new Error("No actual overflow-y scroll ancestor");
        const header = e.closest('[role="dialog"]')?.querySelector("header");
        if (!header) throw new Error("No child header");
        const headerRect = box(header);
        const clip = { left: 0, right: view.innerWidth, top: 0, bottom: view.innerHeight };
        const ancestors = [];
        for (let node = e.parentElement; node; node = node.parentElement) {
          const style = view.getComputedStyle(node),
            rect = box(node);
          const client = {
            left: rect.left + node.clientLeft,
            right: rect.left + node.clientLeft + node.clientWidth,
            top: rect.top + node.clientTop,
            bottom: rect.top + node.clientTop + node.clientHeight,
          };
          const x = ["auto", "scroll", "hidden", "clip"].includes(style.overflowX),
            y = ["auto", "scroll", "hidden", "clip"].includes(style.overflowY);
          if (x) {
            clip.left = Math.max(clip.left, client.left);
            clip.right = Math.min(clip.right, client.right);
          }
          if (y) {
            clip.top = Math.max(clip.top, client.top);
            clip.bottom = Math.min(clip.bottom, client.bottom);
          }
          ancestors.push({
            tag: node.tagName,
            class: node.className,
            rect,
            client,
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            position: style.position,
          });
        }
        const range = view.document.createRange();
        range.selectNodeContents(e);
        const lines = Array.from(range.getClientRects())
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .map((rect) => ({
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          }));
        if (!lines.length) throw new Error("No first response line");
        const safe = {
          left: clip.left,
          right: clip.right,
          top: Math.max(clip.top, headerRect.bottom),
          bottom: Math.min(clip.bottom, composerRect.top),
        };
        const first = lines[0];
        const visible = {
          left: Math.max(first.left, safe.left),
          right: Math.min(first.right, safe.right),
          top: Math.max(first.top, safe.top),
          bottom: Math.min(first.bottom, safe.bottom),
        };
        const painted = visible.right > visible.left && visible.bottom > visible.top;
        const hit = painted
          ? view.document.elementFromPoint(
              (visible.left + visible.right) / 2,
              (visible.top + visible.bottom) / 2,
            )
          : null;
        if (install) {
          const state = { events: [] as ReadingEvent[], scroller: scroll };
          view.__nacInspectorReading = state;
          scroll.addEventListener(
            "wheel",
            (event) =>
              state.events.push({
                type: "wheel",
                isTrusted: event.isTrusted,
                deltaY: event.deltaY,
              }),
            { passive: true },
          );
          scroll.addEventListener(
            "scroll",
            (event) =>
              state.events.push({
                type: "scroll",
                isTrusted: event.isTrusted,
                scrollTop: state.scroller.scrollTop,
              }),
            { passive: true },
          );
        }
        return {
          header: headerRect,
          scroller: box(scroll),
          scrollTop: scroll.scrollTop,
          scrollHeight: scroll.scrollHeight,
          clientHeight: scroll.clientHeight,
          clip,
          ancestors,
          composer: composerRect,
          lines,
          safe,
          visible,
          firstLineHit: !!hit && (hit === e || e.contains(hit)),
          events: view.__nacInspectorReading?.events ?? [],
        };
      },
      { composerRect, install },
    );
  };
  const before = await measure(true);
  await fs.writeFile(outputPath(name + "-reading-before.json"), JSON.stringify(before, null, 2));
  const first = before.lines[0];
  const initiallyVisible =
    first.left >= before.safe.left &&
    first.right <= before.safe.right &&
    first.top >= before.safe.top &&
    first.bottom <= before.safe.bottom;
  let after = before;
  let requestedDelta = 0;
  if (!initiallyVisible) {
    expect(allowGesture, JSON.stringify(before)).toBe(true);
    // Only an older line above the actual scroll clip at the initial bottom-follow position qualifies.
    expect(first.top, JSON.stringify(before)).toBeLessThan(before.clip.top);
    expect(
      Math.abs(before.scrollHeight - before.clientHeight - before.scrollTop),
      JSON.stringify(before),
    ).toBeLessThanOrEqual(1);
    expect(before.scroller.top, JSON.stringify(before)).toBeGreaterThanOrEqual(
      before.header.bottom - 1,
    );
    expect(before.safe.bottom - before.safe.top).toBeGreaterThan(first.height + 8);
    const targetTop = before.safe.top + (before.safe.bottom - before.safe.top - first.height) / 2;
    requestedDelta = -Math.min(before.scrollTop, Math.max(1, targetTop - first.top));
    expect(requestedDelta).toBeLessThan(0);
    const point = {
      x: (before.safe.left + before.safe.right) / 2,
      y: (before.safe.top + before.safe.bottom) / 2,
    };
    expect(
      await paragraph.evaluate((_raw, point) => {
        const view = globalThis as unknown as View;
        const scroll = view.__nacInspectorReading!.scroller;
        const hit = view.document.elementFromPoint(point.x, point.y);
        return hit === scroll || scroll.contains(hit);
      }, point),
    ).toBe(true);
    const scrolled = paragraph.evaluate(
      () =>
        new Promise((resolve) => {
          const view = globalThis as unknown as View;
          view.__nacInspectorReading!.scroller.addEventListener(
            "scroll",
            () => view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve(true))),
            { once: true },
          );
        }),
    );
    await page.mouse.move(point.x, point.y);
    // Geometry is in CSS pixels; browser wheel input uses physical pixels.
    await page.mouse.wheel(0, requestedDelta * zoom);
    await scrolled;
    after = await measure();
  }
  await fs.writeFile(
    outputPath(name + "-reading-after.json"),
    JSON.stringify({ requestedDelta, usedGesture: !initiallyVisible, ...after }, null, 2),
  );
  if (!initiallyVisible) {
    expect(after.events.filter((event) => event.type === "wheel")).toHaveLength(1);
    expect(after.events.find((event) => event.type === "wheel")?.isTrusted).toBe(true);
    expect(after.events.some((event) => event.type === "scroll" && event.isTrusted)).toBe(true);
    expect(after.scrollTop).toBeLessThan(before.scrollTop);
  }
  expect(after.lines[0].left, JSON.stringify(after)).toBeGreaterThanOrEqual(after.safe.left);
  expect(after.lines[0].right, JSON.stringify(after)).toBeLessThanOrEqual(after.safe.right);
  expect(after.lines[0].top, JSON.stringify(after)).toBeGreaterThanOrEqual(after.safe.top);
  expect(after.lines[0].bottom, JSON.stringify(after)).toBeLessThanOrEqual(after.safe.bottom);
  expect(after.firstLineHit, JSON.stringify(after)).toBe(true);
  return !initiallyVisible;
}
