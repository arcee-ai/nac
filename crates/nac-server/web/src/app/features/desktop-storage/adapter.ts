import type {
  PromptDraftPersistenceBinding,
  PromptDraftStorage,
} from "../../store/promptDraftStore";

export interface StorageDocument {
  launch: string;
  view: string;
  document: string;
}
export interface DesktopStoragePort {
  open(): Promise<unknown>;
  write(message: unknown): boolean;
  subscribe(callback: (acknowledgement: unknown) => void): () => void;
  close(): void;
}
export interface DesktopStorage {
  preferences: PromptDraftStorage;
  drafts: PromptDraftStorage;
  binding?: PromptDraftPersistenceBinding;
  status(): "ready" | "pending" | "unavailable";
  subscribe(callback: () => void): () => void;
  flush(): Promise<boolean>;
  close(): void;
}
const identityFields = ["owner", "profile", "organization", "host", "store", "track"] as const;
const documentFields = ["launch", "view", "document"] as const;
const preferenceKeys = new Set([
  "nac-panel-list-width",
  "nac-thread-log-height-ratio",
  "nac.last-light-model",
  "nac.chatTabs",
  "nac.sessionNavigation",
  "nac.sidebar.open",
]);
const byteLimit = 8 * 1024 * 1024;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const identity = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 4096;
const bytes = (value: string) => new TextEncoder().encode(value).length;
export function isDesktopPreferenceKey(key: string): boolean {
  return (
    preferenceKeys.has(key) || (key.startsWith("nac.rightSidebar.collapsed.") && key.length <= 512)
  );
}

/** Only the standalone entry reads ambient storage. Even acquiring a forbidden
 * browser storage object can throw, before a store's own get/set catches run. */
export function safeStorage(
  host: object,
  name: "localStorage" | "sessionStorage",
): PromptDraftStorage | undefined {
  try {
    const value = Reflect.get(host, name);
    if (
      !value ||
      !["getItem", "setItem", "removeItem"].every((key) => typeof value[key] === "function")
    )
      return undefined;
    return {
      getItem: (key) => value.getItem(key),
      setItem: (key, text) => value.setItem(key, text),
      removeItem: (key) => value.removeItem(key),
    };
  } catch {
    return undefined;
  }
}

function parseBootstrap(value: unknown, endpoint: string) {
  if (
    !record(value) ||
    value.version !== 1 ||
    value.endpoint !== endpoint ||
    typeof value.available !== "boolean" ||
    !record(value.document) ||
    !documentFields.every((key) => identity(value.document && Reflect.get(value.document, key))) ||
    !record(value.binding) ||
    !identityFields.every((key) => identity(value.binding && Reflect.get(value.binding, key))) ||
    !record(value.values)
  )
    throw new Error("Invalid desktop storage bootstrap.");
  const binding = Object.freeze(
    Object.fromEntries(
      identityFields.map((key) => [key, Reflect.get(value.binding as object, key)]),
    ),
  ) as unknown as PromptDraftPersistenceBinding;
  const document = Object.freeze(
    Object.fromEntries(
      documentFields.map((key) => [key, Reflect.get(value.document as object, key)]),
    ),
  ) as unknown as StorageDocument;
  const draftKey = `nac:prompt-drafts:v2:${JSON.stringify(identityFields.map((key) => binding[key]))}`;
  const groups = {} as Record<"preferences" | "drafts", Map<string, string>>;
  if (bytes(JSON.stringify(value.values)) > byteLimit) throw new Error("Desktop storage is full.");
  for (const group of ["preferences", "drafts"] as const) {
    const saved = value.values[group];
    if (!record(saved) || Object.keys(saved).length > 256) throw new Error("Invalid checkpoint.");
    groups[group] = new Map();
    for (const [key, text] of Object.entries(saved)) {
      if (
        typeof text !== "string" ||
        !(group === "drafts" ? key === draftKey : isDesktopPreferenceKey(key))
      )
        throw new Error("Invalid checkpoint record.");
      groups[group].set(key, text);
    }
  }
  return { binding, document, draftKey, groups, available: value.available };
}

/** A native capability's absence preserves ordinary browser behavior. A broken
 * native capability gets isolated memory storage, never ambient-origin fallback.
 * These maps adapt the existing stores; no draft, query or submission model lives here. */
export async function openDesktopStorage(
  candidate: unknown,
  endpoint: string,
  timeoutMilliseconds = 1500,
): Promise<DesktopStorage | undefined> {
  if (candidate === undefined) return undefined;
  let closed = false;
  let unavailable = false;
  let sequence = 0;
  let acknowledged = 0;
  let port: DesktopStoragePort | undefined;
  let binding: PromptDraftPersistenceBinding | undefined;
  let document: StorageDocument | undefined;
  let draftKey: string | undefined;
  let groups = { preferences: new Map<string, string>(), drafts: new Map<string, string>() };
  const listeners = new Set<() => void>();
  const waiting = new Map<number, (durable: boolean) => void>();
  const deadlines = new Map<number, ReturnType<typeof setTimeout>>();
  let disconnect = () => {};
  const notify = () => listeners.forEach((listener) => listener());
  const fail = () => {
    unavailable = true;
    for (const timer of deadlines.values()) clearTimeout(timer);
    deadlines.clear();
    for (const resolve of waiting.values()) resolve(false);
    waiting.clear();
    notify();
  };
  try {
    if (
      !record(candidate) ||
      !["open", "write", "subscribe", "close"].every((key) => typeof candidate[key] === "function")
    )
      throw new Error("Desktop storage unavailable.");
    port = candidate as unknown as DesktopStoragePort;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const value = await Promise.race([
      port.open(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Storage bootstrap timed out.")),
          timeoutMilliseconds,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    const parsed = parseBootstrap(value, endpoint);
    ({ binding, document, draftKey, groups } = parsed);
    unavailable = !parsed.available;
    disconnect = port.subscribe((ack) => {
      if (
        closed ||
        !record(ack) ||
        !record(ack.document) ||
        !document ||
        !documentFields.every(
          (key) => Reflect.get(ack.document as object, key) === document![key],
        ) ||
        !Number.isSafeInteger(ack.sequence) ||
        (ack.sequence as number) <= acknowledged ||
        (ack.sequence as number) > sequence ||
        typeof ack.durable !== "boolean"
      )
        return;
      // Native acknowledgements are ordered with the serialized checkpoint writer.
      acknowledged = ack.sequence as number;
      for (const [id, timer] of deadlines) {
        if (id <= acknowledged) {
          clearTimeout(timer);
          deadlines.delete(id);
        }
      }
      if (!ack.durable) {
        fail();
        return;
      }
      for (const [id, resolve] of waiting) {
        if (id <= acknowledged) {
          waiting.delete(id);
          resolve(true);
        }
      }
      notify();
    });
  } catch {
    unavailable = true;
    binding = undefined;
    document = undefined;
    groups = { preferences: new Map(), drafts: new Map() };
  }
  const post = (operation: object): number | null => {
    if (closed || unavailable || !port || !document || sequence >= 2_147_483_647) return null;
    const id = ++sequence;
    deadlines.set(
      id,
      setTimeout(() => {
        deadlines.delete(id);
        fail();
      }, timeoutMilliseconds),
    );
    try {
      if (!port.write({ version: 1, ...document, sequence: id, ...operation })) {
        fail();
        return null;
      }
      notify();
      return id;
    } catch {
      fail();
      return null;
    }
  };
  const facade = (namespace: "preferences" | "drafts"): PromptDraftStorage => {
    const valid = (key: string) =>
      namespace === "drafts" ? key === draftKey : isDesktopPreferenceKey(key);
    return {
      ...(namespace === "drafts" ? { coldImports: true as const } : {}),
      getItem: (key) => groups[namespace].get(key) ?? null,
      setItem: (key, value) => {
        if (closed) return;
        if (!valid(key) && binding) throw new Error("Unsupported presentation record.");
        const candidate = new Map(groups[namespace]);
        candidate.set(key, value);
        if (
          candidate.size > 256 ||
          bytes(JSON.stringify(Object.fromEntries(candidate))) > byteLimit
        )
          throw new Error("Presentation storage is full.");
        groups[namespace] = candidate;
        post({ kind: "write", namespace, key, value });
      },
      removeItem: (key) => {
        if (closed) return;
        groups[namespace].delete(key);
        if (valid(key)) post({ kind: "write", namespace, key, value: null });
      },
    };
  };
  return {
    preferences: facade("preferences"),
    drafts: facade("drafts"),
    binding,
    status: () => (unavailable ? "unavailable" : sequence > acknowledged ? "pending" : "ready"),
    subscribe: (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    flush: () => {
      const id = post({ kind: "flush" });
      if (id === null) return Promise.resolve(false);
      if (acknowledged >= id) return Promise.resolve(!unavailable);
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          fail();
          resolve(false);
        }, timeoutMilliseconds);
        waiting.set(id, (durable) => {
          clearTimeout(timer);
          resolve(durable);
        });
      });
    },
    close: () => {
      if (closed) return;
      closed = true;
      disconnect();
      for (const timer of deadlines.values()) clearTimeout(timer);
      deadlines.clear();
      for (const resolve of waiting.values()) resolve(false);
      waiting.clear();
      listeners.clear();
      try {
        port?.close();
      } catch {
        /* Native retirement is independently fenced. */
      }
    },
  };
}
