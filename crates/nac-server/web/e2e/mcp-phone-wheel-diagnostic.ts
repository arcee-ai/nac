import type { Locator, Page, TestInfo, JSHandle } from "@playwright/test";
import { assertTargets, evidence, expect, geometry, settle } from "./mcp-phone-actions-fixture";

type ReadElement = {
  nodeType: number;
  nodeName: string;
  parentElement: ReadElement | null;
  getAttribute(name: string): string | null;
  getBoundingClientRect(): {
    x: number;
    y: number;
    width: number;
    height: number;
    right: number;
    bottom: number;
  };
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
  clientHeight: number;
  clientWidth: number;
};
type ReadEvent = {
  target: unknown;
  timeStamp: number;
  eventPhase: number;
  defaultPrevented: boolean;
  isTrusted: boolean;
  cancelable: boolean;
  bubbles: boolean;
  composedPath(): unknown[];
};
type ReadWheel = ReadEvent & {
  clientX: number;
  clientY: number;
  pageX: number;
  pageY: number;
  screenX: number;
  screenY: number;
  deltaX: number;
  deltaY: number;
  deltaZ: number;
  deltaMode: number;
};

/** Observation adds protocol/layout work; an instrumented pass is not a product repair. */
export async function observePhoneWheel(owner: Locator, point: { x: number; y: number }) {
  return owner.evaluateHandle((element, expectedPoint) => {
    const root = element as unknown as ReadElement;
    const browser = globalThis as unknown as {
      innerWidth: number;
      innerHeight: number;
      devicePixelRatio: number;
      visualViewport: {
        width: number;
        height: number;
        scale: number;
        offsetLeft: number;
        offsetTop: number;
        pageLeft: number;
        pageTop: number;
      } | null;
      performance: { now(): number };
      getComputedStyle(node: ReadElement): Record<string, string>;
      document: {
        scrollingElement: ReadElement | null;
        elementsFromPoint(x: number, y: number): ReadElement[];
        addEventListener(
          type: string,
          listener: (event: ReadEvent) => void,
          options: { capture: boolean; passive: boolean },
        ): void;
        removeEventListener(
          type: string,
          listener: (event: ReadEvent) => void,
          options: { capture: boolean },
        ): void;
      };
    };
    const document = browser.document;
    const ids = new WeakMap<object, number>();
    let nextId = 0;
    const identity = (target: unknown) => {
      if (target === null || typeof target !== "object") return null;
      if (!ids.has(target)) ids.set(target, ++nextId);
      const node = target as ReadElement;
      return {
        key: ids.get(target)!,
        name: target === browser ? "window" : target === document ? "document" : node.nodeName,
        id: node.nodeType === 1 ? node.getAttribute("id") : null,
        role: node.nodeType === 1 ? node.getAttribute("role") : null,
        label: node.nodeType === 1 ? node.getAttribute("aria-label") : null,
        className: node.nodeType === 1 ? node.getAttribute("class") : null,
      };
    };
    const chain = (start: ReadElement | null) => {
      const nodes: ReadElement[] = [];
      for (let node = start; node; node = node.parentElement) nodes.push(node);
      return nodes;
    };
    const measure = (node: ReadElement) => {
      const rect = node.getBoundingClientRect();
      const style = browser.getComputedStyle(node);
      return {
        identity: identity(node),
        parent: identity(node.parentElement),
        bounds: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
        },
        scrollTop: node.scrollTop,
        scrollLeft: node.scrollLeft,
        scrollHeight: node.scrollHeight,
        scrollWidth: node.scrollWidth,
        clientHeight: node.clientHeight,
        clientWidth: node.clientWidth,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        overscrollBehaviorX: style.overscrollBehaviorX,
        overscrollBehaviorY: style.overscrollBehaviorY,
        pointerEvents: style.pointerEvents,
        position: style.position,
        zIndex: style.zIndex,
        display: style.display,
        visibility: style.visibility,
        contain: style.contain,
        inert: node.getAttribute("inert") !== null,
      };
    };
    const probe = (x: number, y: number, eventPath: ReadElement[] = []) => {
      const hits = document.elementsFromPoint(x, y);
      const chains = [...hits, root, ...eventPath].map((node) => chain(node));
      const nodes = new Set(chains.flat());
      if (document.scrollingElement) nodes.add(document.scrollingElement);
      const viewport = browser.visualViewport;
      return {
        observedAt: browser.performance.now(),
        point: { x, y },
        viewport: {
          width: browser.innerWidth,
          height: browser.innerHeight,
          dpr: browser.devicePixelRatio,
          visual: viewport && {
            width: viewport.width,
            height: viewport.height,
            scale: viewport.scale,
            offsetLeft: viewport.offsetLeft,
            offsetTop: viewport.offsetTop,
            pageLeft: viewport.pageLeft,
            pageTop: viewport.pageTop,
          },
        },
        hitStack: hits.map(identity),
        owner: identity(root),
        scrollingElement: identity(document.scrollingElement),
        chains: chains.map((nodes) => nodes.map(identity)),
        nodes: Array.from(nodes, measure),
      };
    };
    const limit = 128;
    const dropped = { wheel: 0, scroll: 0, attempts: 0 };
    let attempt = 0;
    const attempts: {
      sequence: number;
      pre: ReturnType<typeof probe>;
      post?: ReturnType<typeof probe>;
      remaining?: number;
    }[] = [];
    type Dispatch = { observedAt: number; eventPhase: number; defaultPrevented: boolean };
    const wheel: {
      event: ReadWheel;
      data: {
        attemptAtDispatch: number;
        observedAt: number;
        timeStamp: number;
        isTrusted: boolean;
        cancelable: boolean;
        bubbles: boolean;
        eventPhaseAtCapture: number;
        coordinates: {
          clientX: number;
          clientY: number;
          pageX: number;
          pageY: number;
          screenX: number;
          screenY: number;
        };
        delta: { x: number; y: number; z: number; mode: number };
        target: ReturnType<typeof identity>;
        path: ReturnType<typeof identity>[];
        defaultPreventedAtCapture: boolean;
        actualPoint: ReturnType<typeof probe>;
        postDispatch?: Dispatch;
      };
    }[] = [];
    const scroll: {
      attemptAtDispatch: number;
      observedAt: number;
      timeStamp: number;
      target: ReturnType<typeof identity>;
      node: ReturnType<typeof measure> | null;
      owner: ReturnType<typeof measure>;
    }[] = [];
    const sampleCompletedDispatches = () => {
      for (const record of wheel)
        if (!record.data.postDispatch && record.event.eventPhase === 0)
          record.data.postDispatch = {
            observedAt: browser.performance.now(),
            eventPhase: record.event.eventPhase,
            defaultPrevented: record.event.defaultPrevented,
          };
    };
    const onWheel = (event: ReadEvent) => {
      if (wheel.length === limit) {
        dropped.wheel++;
        return;
      }
      const actual = event as ReadWheel;
      const path = actual.composedPath();
      wheel.push({
        event: actual,
        data: {
          attemptAtDispatch: attempt,
          observedAt: browser.performance.now(),
          timeStamp: actual.timeStamp,
          isTrusted: actual.isTrusted,
          cancelable: actual.cancelable,
          bubbles: actual.bubbles,
          eventPhaseAtCapture: actual.eventPhase,
          coordinates: {
            clientX: actual.clientX,
            clientY: actual.clientY,
            pageX: actual.pageX,
            pageY: actual.pageY,
            screenX: actual.screenX,
            screenY: actual.screenY,
          },
          delta: { x: actual.deltaX, y: actual.deltaY, z: actual.deltaZ, mode: actual.deltaMode },
          target: identity(actual.target),
          path: path.map(identity),
          defaultPreventedAtCapture: actual.defaultPrevented,
          actualPoint: probe(
            actual.clientX,
            actual.clientY,
            path.filter(
              (target): target is ReadElement =>
                target !== null &&
                typeof target === "object" &&
                (target as ReadElement).nodeType === 1,
            ),
          ),
        },
      });
    };
    const onScroll = (event: ReadEvent) => {
      if (scroll.length === limit * 4) {
        dropped.scroll++;
        return;
      }
      const target = event.target as ReadElement | null;
      scroll.push({
        attemptAtDispatch: attempt,
        observedAt: browser.performance.now(),
        timeStamp: event.timeStamp,
        target: identity(target),
        node: target?.nodeType === 1 ? measure(target) : null,
        owner: measure(root),
      });
    };
    document.addEventListener("wheel", onWheel, { capture: true, passive: true });
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return {
      before() {
        sampleCompletedDispatches();
        attempt++;
        if (attempts.length < limit)
          attempts.push({ sequence: attempt, pre: probe(expectedPoint.x, expectedPoint.y) });
        else dropped.attempts++;
      },
      after(remaining: number) {
        sampleCompletedDispatches();
        const record = attempts.find((record) => record.sequence === attempt);
        if (record) {
          record.remaining = remaining;
          record.post = probe(expectedPoint.x, expectedPoint.y);
        }
      },
      finish() {
        document.removeEventListener("wheel", onWheel, { capture: true });
        document.removeEventListener("scroll", onScroll, { capture: true });
        sampleCompletedDispatches();
        return {
          schema: 1,
          timingPerturbation:
            "Passive handlers, layout/style reads, protocol calls, serialization, and artifact I/O add work. No waits are added; an instrumented pass does not establish a product repair.",
          expectedPoint,
          attempted: attempt,
          limits: { wheel: limit, scroll: limit * 4, attempts: limit },
          dropped,
          attempts,
          wheel: wheel.map((record) => ({
            ...record.data,
            dispatchComplete: !!record.data.postDispatch,
          })),
          scroll,
          final: probe(expectedPoint.x, expectedPoint.y),
        };
      },
    };
  }, point);
}

type ResearchElement = ReadElement & {
  disabled: boolean;
  className: string;
  style: {
    overflow: string;
    padding: string;
    gap: string;
    minHeight: string;
    width: string;
    boxSizing: string;
  };
  firstChild: unknown | null;
  appendChild(node: unknown): void;
  insertBefore(node: unknown, reference: unknown): void;
  remove(): void;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  querySelectorAll(selector: string): ArrayLike<ResearchElement>;
  closest(selector: string): ResearchElement | null;
  matches(selector: string): boolean;
};
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Preserve exact primary identity, including an explicit throw undefined. */
export async function runMcpCaseWithCleanup(body: () => Promise<void>, close: () => Promise<void>) {
  let hadPrimary = false;
  let primary: unknown;
  try {
    await body();
  } catch (error) {
    hadPrimary = true;
    primary = error;
  }
  let hadCleanupFailure = false;
  let cleanup: unknown;
  try {
    await close();
  } catch (error) {
    hadCleanupFailure = true;
    cleanup = error;
  }
  if (hadCleanupFailure) {
    if (hadPrimary)
      throw new AggregateError([primary, cleanup], "MCP case primary and cleanup failed", {
        cause: primary,
      });
    throw cleanup;
  }
  if (hadPrimary) throw primary;
}

export function requireMcpResearchEnabled(value: unknown) {
  const state = record(value),
    fieldset = record(state?.fieldset);
  if (
    fieldset?.tag !== "FIELDSET" ||
    fieldset.disabled !== false ||
    fieldset.disabledAttribute !== null ||
    !Array.isArray(state?.controls) ||
    !state.controls.length ||
    !state.controls.every(
      (c) => record(c)?.inNativeFieldset === true && typeof record(c)?.disabled === "boolean",
    )
  )
    throw new Error("Native FIELDSET/control state pending, disabled or incomplete; STOP research");
}

/** This is the actual final Node-side guard after asynchronous preparation. */
export async function runEnabledMcpResearchAction<T>(
  read: () => Promise<unknown>,
  action: () => Promise<T>,
) {
  const current = await read();
  requireMcpResearchEnabled(current);
  return action();
}

/** Browser-side read: native admission and the actual inner scroll owner are separate facts. */
export function readMcpInnerScrollOwner(element: unknown) {
  const scroller = element as ResearchElement;
  const fieldset = scroller.closest("fieldset") as ResearchElement | null;
  return {
    scroller: {
      tag: scroller.nodeName,
      directNativeChild: scroller.parentElement === fieldset,
      clientWidth: scroller.clientWidth,
      clientHeight: scroller.clientHeight,
    },
    fieldset: fieldset && {
      tag: fieldset.nodeName,
      disabled: fieldset.disabled,
      disabledAttribute: fieldset.getAttribute("disabled"),
    },
    controls: fieldset
      ? Array.from(fieldset.querySelectorAll("input,button,select,textarea"), (control) => ({
          disabled: control.matches(":disabled"),
          inNativeFieldset: control.closest("fieldset") === fieldset,
        }))
      : [],
  };
}

export function requireMcpInnerScrollOwner(value: unknown) {
  requireMcpResearchEnabled(value);
  const scroller = record(record(value)?.scroller);
  if (
    scroller?.tag !== "DIV" ||
    scroller.directNativeChild !== true ||
    typeof scroller.clientWidth !== "number" ||
    !Number.isFinite(scroller.clientWidth) ||
    scroller.clientWidth <= 0 ||
    typeof scroller.clientHeight !== "number" ||
    !Number.isFinite(scroller.clientHeight) ||
    scroller.clientHeight <= 0
  )
    throw new Error("Actual inner DIV scroll owner missing or invalid; STOP before wheel oracle");
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const count = (value: unknown): value is number =>
  finite(value) && Number.isInteger(value) && value > 0;
function ownerSnapshot(probe: unknown, key: unknown) {
  const p = record(probe),
    owner = record(p?.owner);
  if (!count(key) || owner?.key !== key || !Array.isArray(p?.nodes)) return undefined;
  const node = p.nodes.map(record).find((n) => record(n?.identity)?.key === key);
  const bounds = record(node?.bounds);
  if (
    !node ||
    record(node.identity)?.name !== "FIELDSET" ||
    !bounds ||
    !["x", "y", "width", "height", "right", "bottom"].every((k) => finite(bounds[k])) ||
    ![
      "scrollTop",
      "scrollLeft",
      "scrollWidth",
      "clientWidth",
      "scrollHeight",
      "clientHeight",
    ].every((k) => finite(node[k])) ||
    (bounds.width as number) <= 0 ||
    (bounds.height as number) <= 0 ||
    (node.clientHeight as number) <= 0 ||
    (node.clientWidth as number) <= 0 ||
    (node.scrollTop as number) < 0 ||
    (node.scrollHeight as number) < (node.clientHeight as number) ||
    (node.scrollWidth as number) < (node.clientWidth as number) ||
    (node.scrollTop as number) > (node.scrollHeight as number) - (node.clientHeight as number) + 1
  )
    return undefined;
  return node as Record<string, unknown> & {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  };
}

/** Complete narrow schema, without pretending remaining/post samples are atomic. */
export function originalStall(primary: unknown, telemetry: unknown, errors: unknown[]) {
  const error = record(primary),
    data = record(telemetry),
    final = record(data?.final);
  const key = record(final?.owner)?.key,
    dropped = record(data?.dropped);
  if (
    record(error?.matcherResult)?.name !== "toBeLessThanOrEqual" ||
    !String(error?.message).includes("waiting on the predicate") ||
    errors.length ||
    data?.schema !== 1 ||
    !count(data?.attempted) ||
    data.attempted < 2 ||
    data.attempted > 128 ||
    !dropped ||
    !["wheel", "scroll", "attempts"].every((k) => dropped[k] === 0) ||
    !Array.isArray(data.wheel) ||
    data.wheel.length !== data.attempted ||
    !Array.isArray(data.attempts) ||
    data.attempts.length !== data.attempted
  )
    return undefined;
  const node = ownerSnapshot(final, key);
  if (!node || node.scrollHeight - node.clientHeight - node.scrollTop <= 1) return undefined;
  for (let i = 0; i < data.attempted; i++) {
    const attempt = record(data.attempts[i]),
      wheel = record(data.wheel[i]);
    const dispatch = record(wheel?.postDispatch),
      coordinates = record(wheel?.coordinates),
      delta = record(wheel?.delta);
    if (
      attempt?.sequence !== i + 1 ||
      !finite(attempt.remaining) ||
      attempt.remaining < 0 ||
      !ownerSnapshot(attempt.pre, key) ||
      !ownerSnapshot(attempt.post, key) ||
      wheel?.isTrusted !== true ||
      wheel.dispatchComplete !== true ||
      !count(wheel.attemptAtDispatch) ||
      wheel.attemptAtDispatch > data.attempted ||
      dispatch?.eventPhase !== 0 ||
      dispatch.defaultPrevented !== false ||
      !coordinates ||
      !finite(coordinates.clientX) ||
      !finite(coordinates.clientY) ||
      !delta ||
      !finite(delta.x) ||
      !finite(delta.y) ||
      delta.y <= 0 ||
      !finite(delta.mode) ||
      ![0, 1, 2].includes(delta.mode)
    )
      return undefined;
  }
  return data.attempts
    .slice(-2)
    .every((a) => ownerSnapshot(record(a)?.pre, key)?.scrollTop === node.scrollTop)
    ? node
    : undefined;
}

/** Passed directly to evaluateHandle: guard reads the actual native node before mutation. */
export function installMcpResearchInnerScroller(element: unknown) {
  const field = element as ResearchElement;
  if (field.nodeName !== "FIELDSET" || field.disabled || field.getAttribute("disabled") !== null)
    throw new Error("Native FIELDSET became disabled before mutation; STOP research");
  const browser = globalThis as unknown as {
    document: { createElement(tag: string): ResearchElement };
  };
  const previousStyle = field.getAttribute("style");
  const controls = Array.from(field.querySelectorAll("input,button,select,textarea"));
  const disabled = controls.map((n) => n.matches(":disabled"));
  const inner = browser.document.createElement("div");
  inner.className = field.className;
  Object.assign(inner.style, { minHeight: "0", width: "100%", boxSizing: "border-box" });
  while (field.firstChild) inner.appendChild(field.firstChild);
  field.appendChild(inner);
  Object.assign(field.style, { overflow: "hidden", padding: "0", gap: "0", minHeight: "0" });
  return {
    semantics() {
      const now = Array.from(field.querySelectorAll("input,button,select,textarea"));
      return (
        now.length === controls.length &&
        now.every(
          (n, i) =>
            n === controls[i] &&
            n.closest("fieldset") === field &&
            n.matches(":disabled") === disabled[i],
        )
      );
    },
    restore() {
      while (inner.firstChild) field.insertBefore(inner.firstChild, inner);
      inner.remove();
      if (previousStyle === null) field.removeAttribute("style");
      else field.setAttribute("style", previousStyle);
    },
  };
}

/** MCP-only post-failure research. Never supplies a replacement test result. */
export async function researchStalledMcpScroll(options: {
  page: Page;
  info: TestInfo;
  form: Locator;
  reopen(timeout: number): Promise<Locator>;
  primary: unknown;
  telemetry: unknown;
  diagnosticErrors: unknown[];
}) {
  const { page, info, primary } = options;
  const admitted = originalStall(primary, options.telemetry, options.diagnosticErrors);
  const report: { status: string; primary: string; arms: unknown[]; errors: string[] } = {
    status: "not-admitted",
    primary: String(primary),
    arms: [],
    errors: [],
  };
  const deadline = Date.now() + 30_000;
  const actionBudget = () => {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error("Post-stall research budget exhausted; no retry/reset");
    return Math.min(2_000, left);
  };
  const measureOwner = (owner: Locator) =>
    owner.evaluate((element) => {
      const node = element as unknown as ResearchElement;
      const fieldset = node.closest("fieldset")!;
      const browser = globalThis as unknown as {
        getComputedStyle(n: ReadElement): Record<string, string>;
      };
      const style = browser.getComputedStyle(node);
      return {
        actualScroller: {
          tag: node.nodeName,
          scrollTop: node.scrollTop,
          scrollLeft: node.scrollLeft,
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
          scrollHeight: node.scrollHeight,
          clientHeight: node.clientHeight,
          bounds: {
            x: node.getBoundingClientRect().x,
            y: node.getBoundingClientRect().y,
            width: node.getBoundingClientRect().width,
            height: node.getBoundingClientRect().height,
            right: node.getBoundingClientRect().right,
            bottom: node.getBoundingClientRect().bottom,
          },
          overflowX: style.overflowX,
          overflowY: style.overflowY,
        },
        fieldset: {
          tag: fieldset.nodeName,
          disabled: fieldset.disabled,
          disabledAttribute: fieldset.getAttribute("disabled"),
          style: fieldset.getAttribute("style"),
        },
        controls: Array.from(fieldset.querySelectorAll("input,button,select,textarea"), (n) => ({
          tag: n.nodeName,
          disabled: n.matches(":disabled"),
          inNativeFieldset: n.closest("fieldset") === fieldset,
        })),
      };
    });
  const pageErrors: Error[] = [];
  const onPageError = (error: Error) => pageErrors.push(error);
  let current = options.form;
  let researchStarted = false;
  let restoration: JSHandle<{ semantics(): boolean; restore(): void }> | undefined;
  try {
    if (!admitted) return;
    // Preserve the ORIGINAL failed state before any real close/reopen or DOM variant.
    await page.screenshot({ path: info.outputPath("f1-wheel-stall-original.png") });
    const original = await measureOwner(current.locator("fieldset"));
    await evidence(info, "f1-wheel-stall-original-state.json", {
      primary: String(primary),
      original,
    });
    requireMcpResearchEnabled(original);
    page.on("pageerror", onPageError);
    report.status = "research-only";
    for (const kind of ["fresh-original-fieldset", "fresh-inner-div"] as const) {
      if (deadline - Date.now() < 12_000)
        throw new Error("Insufficient budget for unchanged10s arm; STOP");
      researchStarted = true;
      await current
        .getByRole("button", { name: "Close", exact: true })
        .click({ timeout: actionBudget() });
      await expect(current).toHaveCount(0, { timeout: actionBudget() });
      current = await options.reopen(actionBudget());
      await settle(current, info, `stall-${kind}-fresh`);
      const fieldset = current.locator("fieldset");
      const fresh = await measureOwner(fieldset);
      requireMcpResearchEnabled(fresh);
      expect(fresh.actualScroller.scrollTop).toBe(0); // Fresh fixture or STOP, never scrollTop rescue.
      let owner = fieldset;
      if (kind === "fresh-inner-div") {
        await runEnabledMcpResearchAction(
          () => measureOwner(fieldset),
          async () => {
            restoration = await fieldset.evaluateHandle(installMcpResearchInnerScroller);
          },
        );
        owner = fieldset.locator(":scope > div").first();
      }
      const before = await measureOwner(owner);
      const box = (await owner.boundingBox())!;
      const point = { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 100) };
      const observer = await observePhoneWheel(owner, point);
      let armError: unknown,
        telemetry: unknown,
        bottomError: string | null = null;
      let callbackError: unknown, lastRemaining: number | undefined;
      const assertionErrors: string[] = [],
        cleanupErrors: unknown[] = [];
      try {
        await runEnabledMcpResearchAction(
          () => measureOwner(owner),
          () => page.mouse.move(point.x, point.y),
        );
        try {
          await expect
            .poll(async () => {
              try {
                actionBudget();
                if (pageErrors.length)
                  throw new AggregateError(pageErrors, "Research page/observer error");
                await observer.evaluate((o) => o.before());
                await runEnabledMcpResearchAction(
                  () => measureOwner(owner),
                  () => page.mouse.wheel(0, 600),
                );
                const remaining = await owner.evaluate((e) => {
                  const n = e as unknown as ReadElement;
                  return n.scrollHeight - n.clientHeight - n.scrollTop;
                });
                await observer.evaluate((o, n) => o.after(n), remaining);
                lastRemaining = remaining;
                return remaining;
              } catch (error) {
                callbackError = error;
                throw error;
              }
            })
            .toBeLessThanOrEqual(1); // Original10s matcher; no threshold/timeout change.
        } catch (error) {
          if (callbackError !== undefined) throw callbackError;
          if (
            record(record(error)?.matcherResult)?.name !== "toBeLessThanOrEqual" ||
            !String(record(error)?.message).includes("waiting on the predicate") ||
            lastRemaining === undefined ||
            lastRemaining <= 1
          )
            throw error;
          bottomError = String(error);
        }
      } catch (error) {
        armError = error;
      } finally {
        try {
          telemetry = await observer.evaluate((o) => o.finish());
        } catch (error) {
          cleanupErrors.push(error);
        }
        try {
          await observer.dispose();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      try {
        const data = record(telemetry),
          dropped = record(data?.dropped);
        if (
          !data ||
          !dropped ||
          !["wheel", "scroll", "attempts"].every((k) => dropped[k] === 0) ||
          !Array.isArray(data.wheel) ||
          data.wheel.length !== data.attempted ||
          !data.wheel.every(
            (e) => record(e)?.isTrusted === true && record(e)?.dispatchComplete === true,
          )
        )
          throw new Error("Incomplete/malformed research telemetry; no causal comparison");
      } catch (error) {
        cleanupErrors.push(error);
      }
      if (armError !== undefined || cleanupErrors.length || pageErrors.length) {
        report.arms.push({
          kind,
          fresh,
          before,
          point,
          bottomError,
          telemetry,
          armError: armError === undefined ? null : String(armError),
          cleanupErrors: cleanupErrors.map(String),
        });
        throw new AggregateError(
          [...(armError === undefined ? [] : [armError]), ...cleanupErrors, ...pageErrors],
          "Research incomplete; STOP arms, preserve original primary",
        );
      }
      const after = await measureOwner(owner);
      const layout = await geometry(current, [
        "Save",
        "Cancel",
        "Delete server",
        "Close",
        "Test connection",
      ]);
      const check = (label: string, assertion: () => void) => {
        try {
          assertion();
        } catch (error) {
          if (!record(record(error)?.matcherResult)) throw error;
          assertionErrors.push(`${label}: ${String(error)}`);
        }
      };
      check("sticky-target-floor-hit-clipping", () =>
        assertTargets([
          {
            state: kind,
            geometry: {
              ...layout,
              targets: layout.targets.filter((t) => t.label !== "Test connection"),
            },
          },
        ]),
      );
      const last = layout.targets.find((t) => t.label === "Test connection")!;
      check("last-field-hit", () => expect(last.centerHit).toBe(true));
      check("last-field-footer-clearance", () =>
        expect(last.rect.bottom).toBeLessThanOrEqual(layout.footer!.y),
      );
      // TRUE owner in BOTH arms: each oracle runs, even if another one fails.
      check("actual-scroller-overflow", () =>
        expect(after.actualScroller.scrollWidth).toBeLessThanOrEqual(
          after.actualScroller.clientWidth + 1,
        ),
      );
      const result = {
        kind,
        fresh,
        before,
        after,
        point,
        bottomError,
        assertionErrors,
        layout,
        telemetry,
        armError: armError === undefined ? null : String(armError),
        cleanupErrors: cleanupErrors.map(String),
        notAcceptance: true,
      };
      report.arms.push(result);
      await evidence(info, `f1-wheel-stall-${kind}.json`, result);
      await page.screenshot({ path: info.outputPath(`f1-wheel-stall-${kind}.png`) });
      if (restoration) {
        expect(await restoration.evaluate((r) => r.semantics())).toBe(true);
        await restoration.evaluate((r) => r.restore());
        await restoration.dispose();
        restoration = undefined;
      }
      if (armError !== undefined || cleanupErrors.length || pageErrors.length)
        throw new AggregateError(
          [...(armError === undefined ? [] : [armError]), ...cleanupErrors, ...pageErrors],
          "Research incomplete; STOP arms, preserve original primary",
        );
    }
  } catch (error) {
    report.status = "incomplete";
    report.errors.push(String(error));
    throw error;
  } finally {
    page.off("pageerror", onPageError);
    if (restoration) {
      try {
        await restoration.evaluate((r) => r.restore());
      } catch (error) {
        report.errors.push(String(error));
        report.status = "incomplete";
      }
      try {
        await restoration.dispose();
      } catch (error) {
        report.errors.push(String(error));
        report.status = "incomplete";
      }
    }
    if (researchStarted) {
      try {
        await current
          .getByRole("button", { name: "Close", exact: true })
          .click({ timeout: actionBudget() });
      } catch (error) {
        report.errors.push(String(error));
        report.status = "incomplete";
      }
    }
    try {
      await evidence(info, "f1-wheel-stall-research.json", report);
    } catch (error) {
      console.error("Post-stall research evidence incomplete; original failure retained", error);
    }
  }
}
