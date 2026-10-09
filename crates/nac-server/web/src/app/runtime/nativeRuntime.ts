import { hashKey, QueryClient } from "@tanstack/react-query";

import { NacClient, nacClient } from "../services/nacClient";
import { api, createNativeApi } from "../services/api";
import {
  subscribeToSessionEvents,
  type SessionStreamHandlers,
  type SessionStreamOptions,
} from "../services/eventStream";
import {
  createPresentationStores,
  releasePresentationStores,
  standalonePresentationStores,
} from "./presentationStores";
import { LifetimeTransport } from "./requestLifetime";

/** Opaque consumer bindings, never credentials or native admission authority. */
export interface NativeRuntimeScope {
  owner: string;
  profile: string;
  organization: string;
  host: string;
  incarnation: string;
  endpoint: string;
  release: string;
}

export interface NativePresentationAssets {
  /** Caller-served directory from the packed asset manifest, never authority. */
  mathjaxFontUrl: string;
}

export interface NativeRuntimeOptions {
  scope: NativeRuntimeScope;
  client: Pick<NacClient, "transport">;
  storage?: Pick<Storage, "getItem" | "setItem">;
  assets?: NativePresentationAssets;
  eventSource?: SessionStreamOptions["eventSource"];
  /** Hosted reads default to no replay; standalone retains its one retry. */
  queryRetry?: false | 1;
}

const runtimes = new WeakMap<QueryClient, NativeRuntime>();
let nextInstance = 0;

export class NativeRuntime {
  readonly id = ++nextInstance;
  readonly scope: Readonly<NativeRuntimeScope>;
  readonly client: NacClient;
  readonly assets: Readonly<NativePresentationAssets> | undefined;
  readonly api: ReturnType<typeof createNativeApi>;
  readonly stores: ReturnType<typeof createPresentationStores>;
  readonly queryClient: QueryClient;
  private readonly controller = new AbortController();
  private readonly disposers = new Set<() => void>();
  private readonly listeners = new Set<() => void>();
  private attachments = 0;
  private detachVersion = 0;
  private readonly eventSource: SessionStreamOptions["eventSource"];

  constructor(options: NativeRuntimeOptions) {
    if (options.scope.endpoint !== options.client.transport.endpoint)
      throw new Error("Runtime scope must name the supplied client's endpoint.");
    this.queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          queryKeyHashFn: (key) => hashKey([this.id, ...key]),
          staleTime: 30_000,
          gcTime: 300_000,
          retry: options.queryRetry ?? false,
          refetchOnWindowFocus: false,
        },
        mutations: { retry: false },
      },
    });
    this.assets = options.assets ? Object.freeze({ ...options.assets }) : undefined;
    this.stores = createPresentationStores(options.storage);
    this.scope = Object.freeze({ ...options.scope });
    this.client = new NacClient(
      new LifetimeTransport(options.client.transport, this.controller.signal),
    );
    this.api = createNativeApi(this.client);
    this.eventSource = options.eventSource;
    runtimes.set(this.queryClient, this);
  }

  readonly isClosed = () => this.controller.signal.aborted;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly events = (id: string, handlers: SessionStreamHandlers): (() => void) => {
    this.controller.signal.throwIfAborted();
    const dispose = subscribeToSessionEvents(id, handlers, {
      client: this.client,
      eventSource: this.eventSource,
      maxConnectionMs: 299_000,
    });
    const release = () => {
      dispose();
      this.disposers.delete(release);
    };
    this.disposers.add(release);
    return release;
  };

  /** StrictMode may release/reacquire a view in the same commit. */
  readonly retain = () => {
    this.attachments += 1;
    this.detachVersion += 1;
    return () => {
      this.attachments -= 1;
      const version = ++this.detachVersion;
      queueMicrotask(() => {
        if (!this.attachments && this.detachVersion === version) this.close();
      });
    };
  };

  /** Replacement requires a new instance, even when endpoint and session IDs match. */
  close(): void {
    if (this.isClosed()) return;
    this.controller.abort(new DOMException("Native runtime was closed.", "AbortError"));
    for (const dispose of this.disposers) dispose();
    this.disposers.clear();
    void this.queryClient.cancelQueries();
    this.queryClient.clear();
    releasePresentationStores(this.stores);
    for (const listener of this.listeners) listener();
  }
}

export function createNativeRuntime(options: NativeRuntimeOptions): NativeRuntime {
  return new NativeRuntime(options);
}

// Compatibility for existing standalone hook fixtures. Production supplies an explicit runtime.
export const standaloneRuntime: RuntimeDependencies = {
  api,
  client: nacClient,
  stores: standalonePresentationStores,
  events: (id: string, handlers: SessionStreamHandlers) => subscribeToSessionEvents(id, handlers),
};
export type RuntimeDependencies = Pick<NativeRuntime, "api" | "client" | "stores" | "events"> &
  Partial<Pick<NativeRuntime, "id" | "assets">>;
export function runtimeForQueryClient(client: QueryClient): RuntimeDependencies {
  return runtimes.get(client) ?? standaloneRuntime;
}
