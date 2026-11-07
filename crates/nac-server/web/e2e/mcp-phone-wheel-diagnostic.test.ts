// @vitest-environment node
import fs from "node:fs/promises";
import { expect as playwrightExpect } from "@playwright/test";
import { describe, expect, test, vi } from "vitest";
import {
  installMcpResearchInnerScroller,
  originalStall,
  requireMcpResearchEnabled,
  requireMcpInnerScrollOwner,
  runEnabledMcpResearchAction,
  runMcpCaseWithCleanup,
} from "./mcp-phone-wheel-diagnostic";

async function rejection(run: () => Promise<unknown>) {
  let rejected = false;
  let value: unknown;
  try {
    await run();
  } catch (error) {
    rejected = true;
    value = error;
  }
  expect(rejected).toBe(true);
  return value;
}
async function actualBottomError() {
  return rejection(async () => {
    await playwrightExpect.poll(() => 100, { timeout: 1, intervals: [1] }).toBeLessThanOrEqual(1);
  });
}
const enabled = () => ({
  fieldset: { tag: "FIELDSET", disabled: false, disabledAttribute: null as string | null },
  controls: [{ disabled: false, inNativeFieldset: true }],
});
function sample() {
  const node = {
    identity: { key: 1, name: "FIELDSET" },
    scrollTop: 600,
    scrollLeft: 0,
    scrollHeight: 3058,
    clientHeight: 764,
    scrollWidth: 169,
    clientWidth: 161,
    bounds: { x: 0, y: 56, width: 161, height: 764, right: 161, bottom: 820 },
  };
  const probe = () => ({ owner: { key: 1 }, nodes: [structuredClone(node)] });
  return {
    schema: 1,
    attempted: 2,
    dropped: { wheel: 0, scroll: 0, attempts: 0 },
    final: probe(),
    attempts: [1, 2].map((sequence) => ({
      sequence,
      pre: probe(),
      post: probe(),
      remaining: 1694,
    })),
    wheel: [1, 2].map((attemptAtDispatch) => ({
      attemptAtDispatch,
      isTrusted: true,
      dispatchComplete: true,
      postDispatch: { eventPhase: 0, defaultPrevented: false },
      coordinates: { clientX: 80, clientY: 156 },
      delta: { x: 0, y: 600, mode: 0 },
    })),
  };
}

describe("MCP primary and outer cleanup", () => {
  test("retains exact original object when cleanup succeeds", async () => {
    const primary = new Error("original bottom failure");
    const close = vi.fn(async () => undefined);
    expect(
      await rejection(() =>
        runMcpCaseWithCleanup(async () => {
          throw primary;
        }, close),
      ),
    ).toBe(primary);
    expect(close).toHaveBeenCalledOnce();
  });
  test.each([new Error("primary"), undefined, null])(
    "retains primary presence/order/cause: %s",
    async (primary) => {
      const cleanup = new Error("zoom close failure");
      const error = await rejection(() =>
        runMcpCaseWithCleanup(
          async () => {
            throw primary;
          },
          async () => {
            throw cleanup;
          },
        ),
      );
      expect(error).toBeInstanceOf(AggregateError);
      const aggregate = error as AggregateError;
      expect(aggregate.errors).toHaveLength(2);
      expect(aggregate.errors[0]).toBe(primary);
      expect(aggregate.errors[1]).toBe(cleanup);
      expect(Object.hasOwn(aggregate, "cause")).toBe(true);
      expect(aggregate.cause).toBe(primary);
    },
  );
  test("throws cleanup truthfully without a primary", async () => {
    const cleanup = new Error("close");
    expect(
      await rejection(() =>
        runMcpCaseWithCleanup(
          async () => undefined,
          async () => {
            throw cleanup;
          },
        ),
      ),
    ).toBe(cleanup);
    expect(
      await rejection(() =>
        runMcpCaseWithCleanup(
          async () => {
            throw undefined;
          },
          async () => undefined,
        ),
      ),
    ).toBeUndefined();
  });
});

describe("fresh native enabled admission", () => {
  test("rejects native property/attribute and lost control ancestry", () => {
    expect(() => requireMcpResearchEnabled(enabled())).not.toThrow();
    for (const state of [
      { ...enabled(), fieldset: { ...enabled().fieldset, disabled: true } },
      { ...enabled(), fieldset: { ...enabled().fieldset, disabledAttribute: "" } },
      { ...enabled(), controls: [{ disabled: true, inNativeFieldset: false }] },
    ])
      expect(() => requireMcpResearchEnabled(state)).toThrow("STOP research");
  });
  test("asynchronous pending transition denies the actual input callback", async () => {
    let resume!: () => void;
    const preparation = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const state = enabled();
    const action = vi.fn(async () => undefined);
    const operation = runEnabledMcpResearchAction(async () => {
      await preparation;
      return state;
    }, action);
    state.fieldset.disabled = true;
    resume();
    await expect(operation).rejects.toThrow("STOP research");
    expect(action).not.toHaveBeenCalled();
    await runEnabledMcpResearchAction(async () => enabled(), action);
    expect(action).toHaveBeenCalledOnce();
  });
  test("actual browser mutation function refuses disabled before touching any node", () => {
    for (const [disabled, attribute] of [
      [true, null],
      [false, ""],
    ] as const) {
      const touch = vi.fn(() => {
        throw new Error("must not touch DOM");
      });
      const field = {
        nodeName: "FIELDSET",
        disabled,
        getAttribute: () => attribute,
        querySelectorAll: touch,
      };
      expect(() => installMcpResearchInnerScroller(field)).toThrow("before mutation");
      expect(touch).not.toHaveBeenCalled();
    }
  });
});

test("the non-scrolling outer fieldset cannot stand in for the actual inner owner", () => {
  const state = {
    ...enabled(),
    scroller: { tag: "DIV", directNativeChild: true, clientWidth: 161, clientHeight: 764 },
  };
  expect(() => requireMcpInnerScrollOwner(state)).not.toThrow();
  for (const scroller of [
    { ...state.scroller, tag: "FIELDSET" },
    { ...state.scroller, directNativeChild: false },
    { ...state.scroller, clientWidth: 0 },
    { ...state.scroller, clientHeight: Number.NaN },
  ])
    expect(() => requireMcpInnerScrollOwner({ ...state, scroller })).toThrow("inner DIV");
  expect(() =>
    requireMcpInnerScrollOwner({ ...state, fieldset: { ...state.fieldset, disabled: true } }),
  ).toThrow("STOP research");
});

describe("complete stationary original witness", () => {
  test("uses a real inert Playwright predicate error and rejects ordinary callback errors", async () => {
    const primary = await actualBottomError();
    expect(originalStall(primary, sample(), [])).toBeDefined();
    expect(originalStall(new Error("page/read callback failed"), sample(), [])).toBeUndefined();
    expect(
      originalStall(primary, sample(), [new Error("observer callback failed")]),
    ).toBeUndefined();
  });
  test("denies missing post/remaining, truncation, nonfinite geometry/counts, drops and untrusted input", async () => {
    const primary = await actualBottomError();
    const mutations = [
      (s: ReturnType<typeof sample>) => {
        Reflect.deleteProperty(s.attempts[0]!, "post");
      },
      (s: ReturnType<typeof sample>) => {
        Reflect.deleteProperty(s.attempts[0]!, "remaining");
      },
      (s: ReturnType<typeof sample>) => {
        s.attempts = s.attempts.slice(-1);
      },
      (s: ReturnType<typeof sample>) => {
        s.attempted = Number.NaN;
      },
      (s: ReturnType<typeof sample>) => {
        s.final.nodes[0]!.bounds.width = Infinity;
      },
      (s: ReturnType<typeof sample>) => {
        s.attempts[0]!.post.nodes[0]!.scrollTop = Number.NaN;
      },
      (s: ReturnType<typeof sample>) => {
        s.attempts[0]!.remaining = Infinity;
      },
      (s: ReturnType<typeof sample>) => {
        s.dropped.wheel = 1;
      },
      (s: ReturnType<typeof sample>) => {
        s.wheel[0]!.isTrusted = false;
      },
      (s: ReturnType<typeof sample>) => {
        s.wheel[0]!.dispatchComplete = false;
      },
    ];
    for (const mutate of mutations) {
      const state = sample();
      mutate(state);
      expect(originalStall(primary, state, [])).toBeUndefined();
    }
  });
  const manifest = process.env.NAC_MCP_WHEEL_CONTROL_INPUTS;
  test.skipIf(!manifest)(
    "accepts all six external full Linux records and denies their incomplete derivatives",
    async () => {
      const paths: string[] = JSON.parse(await fs.readFile(manifest!, "utf8"));
      expect(paths).toHaveLength(6);
      const primary = await actualBottomError();
      for (const path of paths) {
        const full = JSON.parse(await fs.readFile(path, "utf8"));
        expect(originalStall(primary, full.telemetry, full.diagnosticErrors)).toBeDefined();
        for (const corrupt of ["post", "remaining", "truncate", "nonfinite"] as const) {
          const damaged = structuredClone(full.telemetry);
          if (corrupt === "post") delete damaged.attempts[0].post;
          else if (corrupt === "remaining") delete damaged.attempts[0].remaining;
          else if (corrupt === "truncate") damaged.attempts = damaged.attempts.slice(-2);
          else
            damaged.final.nodes.find(
              (n: { identity: { key: number } }) => n.identity.key === damaged.final.owner.key,
            ).clientHeight = Infinity;
          expect(originalStall(primary, damaged, full.diagnosticErrors)).toBeUndefined();
        }
      }
    },
  );
});
