export type SessionTargetOutcome = "opened" | "deferred" | "unavailable" | "stale";
export interface NotificationSessionTarget {
  session_id: string;
  occurrence_id: string;
}
export interface DesktopSessionTargetPort {
  connectSessionTarget?(owner: (message: unknown) => Promise<SessionTargetOutcome>): () => void;
}

const keys = (value: Record<string, unknown>, expected: string[]) =>
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));
const id = (value: unknown) =>
  typeof value === "string" &&
  value.length > 0 &&
  new TextEncoder().encode(value).length <= 512 &&
  !/\p{Cc}/u.test(value);

/** One bounded UI lookup; a newer explicit response aborts the former lookup.
 * The native document adapter owns exact profile/launch/view/document matching. */
export function connectSessionTargets(
  port: DesktopSessionTargetPort,
  open: (target: NotificationSessionTarget, signal: AbortSignal) => Promise<SessionTargetOutcome>,
): () => void {
  if (!port.connectSessionTarget) return () => {};
  let active = true;
  let lastRequest = 0;
  let flight: AbortController | undefined;
  const disconnect = port.connectSessionTarget(async (message) => {
    if (!active || !message || typeof message !== "object") return "stale";
    const request = message as Record<string, unknown>;
    const target = request.target as Record<string, unknown> | undefined;
    if (
      !keys(request, [
        "version",
        "request",
        "source",
        "profile",
        "launch",
        "view",
        "document",
        "target",
      ]) ||
      request.version !== 1 ||
      request.source !== "notification-response" ||
      !Number.isSafeInteger(request.request) ||
      (request.request as number) <= lastRequest ||
      (request.request as number) > 2147483647 ||
      ![request.profile, request.launch, request.view, request.document].every(id) ||
      !target ||
      typeof target !== "object" ||
      !keys(target, ["session_id", "occurrence_id"]) ||
      !id(target.session_id) ||
      !id(target.occurrence_id)
    )
      return "unavailable";
    lastRequest = request.request as number; // consume before invoking/reentrancy
    flight?.abort();
    const current = new AbortController();
    flight = current;
    try {
      const outcome = await open(target as unknown as NotificationSessionTarget, current.signal);
      return active && flight === current && !current.signal.aborted ? outcome : "stale";
    } catch {
      return !active || current.signal.aborted ? "stale" : "unavailable";
    } finally {
      if (flight === current) flight = undefined;
    }
  });
  return () => {
    active = false;
    flight?.abort();
    flight = undefined;
    disconnect();
  };
}
