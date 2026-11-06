const LIMIT = 2048;
let records = 0;
const uuid = (value) => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
export function phaseKey(path, body, request) {
    const observer = path.match(/\/observers\/([a-f0-9-]{36})\/read$/i)?.[1];
    if (!uuid(observer) || !uuid(request))
        return undefined;
    const cursor = body?.acknowledge_offset ?? "0";
    if (typeof cursor !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(cursor))
        return undefined;
    return { observer, cursor, request };
}
export function phaseClock() {
    return performance.now();
}
export function phaseRecord(phase, started, key) {
    if (typeof __NAC_TERMINAL_PHASE_PROFILE__ === "undefined" || !__NAC_TERMINAL_PHASE_PROFILE__)
        return;
    if (!uuid(key.observer) ||
        typeof key.cursor !== "string" ||
        !/^(0|[1-9][0-9]{0,19})$/.test(key.cursor))
        return;
    if (key.request !== undefined && !uuid(key.request))
        return;
    try {
        if (!Number.isFinite(started) || started < 0)
            return;
        const seq = records++;
        if (seq > LIMIT)
            return;
        const now = performance.now();
        if (!Number.isFinite(now) || now < started)
            return;
        console.debug("NAC_TERMINAL_PHASE " +
            JSON.stringify(seq === LIMIT
                ? { schema: 1, side: "client", phase: "truncated", seq }
                : {
                    schema: 1,
                    side: "client",
                    phase,
                    seq,
                    at_us: Math.round(now * 1000),
                    elapsed_us: Math.max(0, Math.round((now - started) * 1000)),
                    observer: key.observer,
                    cursor: key.cursor,
                    ...(key.request === undefined ? {} : { request: key.request }),
                }));
    }
    catch {
        /* Profiling must never change delivery or error semantics. */
    }
}
