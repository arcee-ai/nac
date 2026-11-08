import type { ProductContext, ProductNavigationRequest, ProductNavigationResolution } from "../../types/api";
import type { NotificationSessionTarget, SessionTargetOutcome } from "../desktop-commands/sessionTarget";
export interface ProductNavigationAdapter {
    currentSession(): string | null;
    open(resolution: ProductNavigationResolution): boolean;
    openNotificationSessionTarget?(sessionId: string): void;
}
/** One runtime owns this explicit-action bridge. Nothing reads Markdown or
 * subscribes to answers. Connecting a browser never replays headless requests. */
export declare class ProductNavigation {
    private readonly resolve;
    private readonly closed;
    private readonly inspect?;
    private adapter;
    private version;
    constructor(resolve: (request: ProductNavigationRequest) => Promise<ProductNavigationResolution>, closed: () => boolean, inspect?: ((sessionId: string | null, signal?: AbortSignal) => Promise<ProductContext>) | undefined);
    connect(adapter: ProductNavigationAdapter): () => void;
    close(): void;
    /** Reuse the normal full-chat lifecycle. It may resume already authorized
     * durable intent; this request carries no new intent or permission action. */
    openNotificationSessionTarget(target: NotificationSessionTarget, signal: AbortSignal, canNavigate: () => boolean): Promise<SessionTargetOutcome>;
    /** Call only for a user click or explicit navigation request. The server
     * validates build/session; the attached consumer validates visibility/view. */
    open(request: ProductNavigationRequest): Promise<ProductNavigationResolution>;
}
