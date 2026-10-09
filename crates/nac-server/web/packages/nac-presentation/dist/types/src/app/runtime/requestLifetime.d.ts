import { NacTransport, type NacHttpTransport, type NacRequestOptions, type NacStreamContext, type CommandAdmission } from "../services/nacClient";
/** Cancel waiting on adapters which may ignore AbortSignal, and discard their late results. */
export declare function withinLifetime<T>(signal: AbortSignal, read: () => Promise<T>): Promise<T>;
/** Uses the existing transport, including fresh headers, error decoding and admission. */
export declare class LifetimeTransport extends NacTransport {
    private readonly source;
    private readonly lifetime;
    constructor(source: NacHttpTransport, lifetime: AbortSignal);
    url(path: string): string;
    eventSourceInit(): EventSourceInit;
    newRequestId(): string;
    streamContext(): Promise<NacStreamContext>;
    admit<T>(method: Parameters<NacTransport["admit"]>[0], path: string, options?: NacRequestOptions): Promise<CommandAdmission<T>>;
    request<T>(method: Parameters<NacTransport["request"]>[0], path: string, options?: NacRequestOptions): Promise<T>;
}
