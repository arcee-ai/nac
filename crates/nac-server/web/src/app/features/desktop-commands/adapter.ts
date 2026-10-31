/** UI delivery only. This port carries no server, file, shell or input authority. */
export type DesktopUIAction = "newSession" | "settings" | "projects";
export interface DesktopCommandPort {
  connect(owner: (message: unknown) => boolean): () => void;
}
export type DesktopUIOwners = Record<DesktopUIAction, () => boolean | void>;

export function connectDesktopCommands(
  port: DesktopCommandPort | undefined,
  owners: DesktopUIOwners,
): () => void {
  if (!port) return () => {};
  let active = true;
  let lastRequest = 0;
  const disconnect = port.connect((message) => {
    if (!active || !message || typeof message !== "object") return false;
    const request = message as Record<string, unknown>;
    if (
      Object.keys(request).length !== 3 ||
      !["version", "request", "action"].every((key) => Object.hasOwn(request, key)) ||
      request.version !== 1 ||
      !Number.isSafeInteger(request.request) ||
      (request.request as number) <= lastRequest ||
      (request.request as number) > 2147483647 ||
      (request.action !== "newSession" &&
        request.action !== "settings" &&
        request.action !== "projects")
    )
      return false;
    // Consume before invoking: throwing or synchronously replacing an owner never replays.
    lastRequest = request.request as number;
    try {
      return owners[request.action]() !== false;
    } catch {
      return false;
    }
  });
  return () => {
    if (!active) return;
    active = false;
    disconnect();
  };
}

/** Browser-only startup has no injected capability and installs nothing. */
export function readDesktopCommandPort(source: unknown): DesktopCommandPort | undefined {
  if (!source || typeof source !== "object") return undefined;
  const port = source as Partial<DesktopCommandPort>;
  return typeof port.connect === "function" ? (port as DesktopCommandPort) : undefined;
}
