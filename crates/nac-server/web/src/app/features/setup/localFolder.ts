/** Available only in an identified local desktop presentation. The chosen path
 * is form data, never permission or project admission. */
export interface NativeDirectoryPort {
  chooseDirectory(initialPath: string, signal: AbortSignal): Promise<string | null>;
}

export function readNativeDirectoryPort(source: unknown): NativeDirectoryPort | undefined {
  if (!source || typeof source !== "object") return undefined;
  return typeof (source as Partial<NativeDirectoryPort>).chooseDirectory === "function"
    ? (source as NativeDirectoryPort)
    : undefined;
}

/** Runtime retirement aborts the native panel even before React removes the
 * initiating form. A late successful adapter result cannot cross this fence. */
export function bindNativeDirectoryPort(
  port: NativeDirectoryPort | undefined,
  lifetime: AbortSignal,
): NativeDirectoryPort | undefined {
  if (!port) return undefined;
  return {
    async chooseDirectory(initialPath, signal) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal.aborted || lifetime.aborted) abort();
      signal.addEventListener("abort", abort, { once: true });
      lifetime.addEventListener("abort", abort, { once: true });
      try {
        controller.signal.throwIfAborted();
        const path = await port.chooseDirectory(initialPath, controller.signal);
        controller.signal.throwIfAborted();
        return path;
      } finally {
        signal.removeEventListener("abort", abort);
        lifetime.removeEventListener("abort", abort);
      }
    },
  };
}

export function localDirectoryCapability(
  port: NativeDirectoryPort | undefined,
  local: boolean,
  kind: string,
  ssh: unknown,
): NativeDirectoryPort | undefined {
  return local && kind === "directory" && !ssh ? port : undefined;
}

/** One form invocation. Detach cancels the native sheet and fences callbacks,
 * including adapters that settle after cancellation. No result is replayed. */
export function selectLocalFolder(
  port: NativeDirectoryPort,
  initialPath: string,
  callbacks: {
    selected: (path: string) => void;
    cancelled: () => void;
    failed: (error: unknown) => void;
  },
): { cancel: () => void; settled: Promise<void> } {
  const controller = new AbortController();
  const settled = Promise.resolve()
    .then(() => {
      if (controller.signal.aborted) return null;
      return port.chooseDirectory(initialPath, controller.signal);
    })
    .then(
      (path) => {
        if (controller.signal.aborted) return;
        if (path === null) callbacks.cancelled();
        else if (
          typeof path !== "string" ||
          !path.startsWith("/") ||
          path.includes("\0") ||
          new TextEncoder().encode(path).length > 16_384
        )
          callbacks.failed(new Error("The folder picker returned an invalid local path."));
        else callbacks.selected(path);
      },
      (error: unknown) => {
        if (!controller.signal.aborted) callbacks.failed(error);
      },
    );
  return { cancel: () => controller.abort(), settled };
}
