import { QueryClient } from "@tanstack/react-query";
import { NacClient } from "../services/nacClient";
import { createNativeApi } from "../services/api";
import { type SessionStreamHandlers, type SessionStreamOptions } from "../services/eventStream";
import { createPresentationStores } from "./presentationStores";
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
export declare class NativeRuntime {
    readonly id: number;
    readonly scope: Readonly<NativeRuntimeScope>;
    readonly client: NacClient;
    readonly assets: Readonly<NativePresentationAssets> | undefined;
    readonly api: ReturnType<typeof createNativeApi>;
    readonly stores: ReturnType<typeof createPresentationStores>;
    readonly queryClient: QueryClient;
    private readonly controller;
    private readonly disposers;
    private readonly listeners;
    private attachments;
    private detachVersion;
    private readonly eventSource;
    constructor(options: NativeRuntimeOptions);
    readonly isClosed: () => boolean;
    readonly subscribe: (listener: () => void) => () => void;
    readonly events: (id: string, handlers: SessionStreamHandlers) => (() => void);
    /** StrictMode may release/reacquire a view in the same commit. */
    readonly retain: () => () => void;
    /** Replacement requires a new instance, even when endpoint and session IDs match. */
    close(): void;
}
export declare function createNativeRuntime(options: NativeRuntimeOptions): NativeRuntime;
export declare const standaloneRuntime: RuntimeDependencies;
export type RuntimeDependencies = Pick<NativeRuntime, "api" | "client" | "stores" | "events"> & Partial<Pick<NativeRuntime, "id" | "assets">>;
export declare function runtimeForQueryClient(client: QueryClient): RuntimeDependencies;
