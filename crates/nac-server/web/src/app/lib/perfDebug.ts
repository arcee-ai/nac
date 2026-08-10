// Dev-only render/stream instrumentation for the chat.
//
// Everything here compiles away in production: `import.meta.env.DEV` is a
// literal, so the bundler drops the bodies and the call sites become no-ops.
// It is also off by default in dev — turn it on from the console with
// `__perf.on()`, run a prompt, then `__perf.report()`.

const DEV = import.meta.env.DEV;
const STORAGE_KEY = "nac.perf";

interface Counter {
  /** How many times the tag fired. */
  count: number;
  /** Summed duration for tags that carry one (commits, timed sections). */
  totalMs: number;
  maxMs: number;
  /** Extra numeric fields summed across calls, e.g. appended characters. */
  sums: Record<string, number>;
}

let enabled = false;
let epoch = 0;
let startedAt = 0;
const counters = new Map<string, Counter>();
const lastLogAt = new Map<string, number>();

export function perfEnabled(): boolean {
  return DEV && enabled;
}

function counter(tag: string): Counter {
  let entry = counters.get(tag);
  if (!entry) {
    entry = { count: 0, totalMs: 0, maxMs: 0, sums: {} };
    counters.set(tag, entry);
  }
  return entry;
}

function shouldLog(tag: string, throttleMs: number): boolean {
  if (throttleMs <= 0) return true;
  const now = performance.now();
  const previous = lastLogAt.get(tag) ?? -Infinity;
  if (now - previous < throttleMs) return false;
  lastLogAt.set(tag, now);
  return true;
}

export interface PerfOptions {
  /** Duration to fold into the tag's totals. */
  ms?: number;
  /** Numeric fields summed into the report and printed on the log line. */
  fields?: Record<string, number | string>;
  /** Minimum gap between console lines for this tag. 0 logs every call. */
  throttleMs?: number;
  /** Log even when throttled if `ms` reached this. */
  slowMs?: number;
}

/** Record one occurrence of `tag` and, subject to throttling, print it. */
export function perfMark(tag: string, options: PerfOptions = {}): void {
  if (!DEV || !enabled) return;

  const entry = counter(tag);
  entry.count += 1;
  if (options.ms != null) {
    entry.totalMs += options.ms;
    entry.maxMs = Math.max(entry.maxMs, options.ms);
  }
  for (const [key, value] of Object.entries(options.fields ?? {})) {
    if (typeof value === "number") {
      entry.sums[key] = (entry.sums[key] ?? 0) + value;
    }
  }

  const slow = options.slowMs != null && (options.ms ?? 0) >= options.slowMs;
  if (!slow && !shouldLog(tag, options.throttleMs ?? 0)) return;

  const parts = [`[perf] ${tag}`, `n=${entry.count}`, `e=${epoch}`];
  if (options.ms != null) parts.push(`${options.ms.toFixed(1)}ms`);
  for (const [key, value] of Object.entries(options.fields ?? {})) {
    parts.push(`${key}=${value}`);
  }
  console.log(parts.join(" "));
}

/**
 * Bump the epoch. Called once per incoming stream delta so every counter line
 * can be read as "how much work did delta #N cause".
 */
export function perfEpoch(): void {
  if (!DEV || !enabled) return;
  epoch += 1;
}

/** Count a component render. Safe to call unconditionally: it is not a hook. */
export function perfRender(tag: string, throttleMs = 1000): void {
  perfMark(`render:${tag}`, { throttleMs });
}

/** Time a synchronous section and fold the duration into `tag`. */
export function perfTime<T>(tag: string, run: () => T, slowMs = 4): T {
  if (!DEV || !enabled) return run();
  const started = performance.now();
  const result = run();
  perfMark(`time:${tag}`, {
    ms: performance.now() - started,
    throttleMs: 1000,
    slowMs,
  });
  return result;
}

function report(): void {
  const elapsed = startedAt ? (performance.now() - startedAt) / 1000 : 0;
  const rows: Record<string, Record<string, string | number>> = {};
  const ordered = [...counters].sort((a, b) => b[1].count - a[1].count);
  for (const [tag, entry] of ordered) {
    rows[tag] = {
      count: entry.count,
      "per s": elapsed ? Number((entry.count / elapsed).toFixed(2)) : 0,
      "total ms": Number(entry.totalMs.toFixed(1)),
      "avg ms": entry.count
        ? Number((entry.totalMs / entry.count).toFixed(2))
        : 0,
      "max ms": Number(entry.maxMs.toFixed(1)),
      ...entry.sums,
    };
  }
  console.log(
    `[perf] report over ${elapsed.toFixed(1)}s, ${epoch} stream deltas`,
  );
  console.table(rows);
}

function reset(): void {
  counters.clear();
  lastLogAt.clear();
  epoch = 0;
  startedAt = performance.now();
}

if (DEV) {
  enabled = localStorage.getItem(STORAGE_KEY) === "1";
  if (enabled) startedAt = performance.now();
  (window as unknown as { __perf: unknown }).__perf = {
    on() {
      enabled = true;
      localStorage.setItem(STORAGE_KEY, "1");
      reset();
      console.log("[perf] on — run a prompt, then __perf.report()");
    },
    off() {
      enabled = false;
      localStorage.removeItem(STORAGE_KEY);
    },
    report,
    reset,
    get counters() {
      return Object.fromEntries(counters);
    },
  };
}
