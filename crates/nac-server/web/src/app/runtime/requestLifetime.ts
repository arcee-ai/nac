import {
  NacTransport,
  ApiError,
  type NacHttpTransport,
  type NacRequestOptions,
  type NacStreamContext,
  type CommandAdmission,
} from "../services/nacClient";

/** Cancel waiting on adapters which may ignore AbortSignal, and discard their late results. */
export function withinLifetime<T>(signal: AbortSignal, read: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return read();
      })
      .then(
        (value) => {
          signal.removeEventListener("abort", abort);
          if (signal.aborted) reject(signal.reason);
          else resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
  });
}

/** An installed client and native source may have separate error constructors. */
function nativeHttpError(error: unknown): unknown {
  if (error instanceof ApiError) return error;
  if (
    error instanceof Error &&
    error.name === "ApiError" &&
    "status" in error &&
    typeof error.status === "number" &&
    "method" in error &&
    typeof error.method === "string" &&
    "path" in error &&
    typeof error.path === "string" &&
    "requestId" in error &&
    typeof error.requestId === "string"
  ) {
    const local = new ApiError(error.status, error.method, error.path, "", error.requestId);
    local.message = error.message;
    local.cause = error;
    return local;
  }
  return error;
}

/** Uses the existing transport, including fresh headers, error decoding and admission. */
export class LifetimeTransport extends NacTransport {
  constructor(
    private readonly source: NacHttpTransport,
    private readonly lifetime: AbortSignal,
  ) {
    super({
      endpoint: source.endpoint,
      credentials: source.credentials,
      version: source.versionPolicy,
      authorization: source.authorization,
    });
  }

  override eventSourceInit(): EventSourceInit {
    this.lifetime.throwIfAborted();
    return this.source.eventSourceInit();
  }

  override newRequestId(): string {
    return this.source.newRequestId();
  }

  override streamContext(): Promise<NacStreamContext> {
    return withinLifetime(this.lifetime, () => this.source.streamContext());
  }

  override async admit<T>(
    method: Parameters<NacTransport["admit"]>[0],
    path: string,
    options: NacRequestOptions = {},
  ): Promise<CommandAdmission<T>> {
    const signal = options.signal
      ? AbortSignal.any([this.lifetime, options.signal])
      : this.lifetime;
    const requestId = options.requestId ?? this.source.newRequestId();
    if (signal.aborted) return { status: "not-sent", requestId, reason: "aborted" };
    try {
      return await withinLifetime(signal, () =>
        this.source.admit<T>(method, path, { ...options, requestId, signal }),
      );
    } catch (error) {
      if (signal.aborted) return { status: "uncertain", requestId, error };
      throw nativeHttpError(error);
    }
  }

  override request<T>(
    method: Parameters<NacTransport["request"]>[0],
    path: string,
    options: NacRequestOptions = {},
  ): Promise<T> {
    const signal = options.signal
      ? AbortSignal.any([this.lifetime, options.signal])
      : this.lifetime;
    return withinLifetime(signal, () =>
      this.source.request<T>(method, path, { ...options, signal }),
    ).catch((error: unknown) => {
      throw nativeHttpError(error);
    });
  }
}
