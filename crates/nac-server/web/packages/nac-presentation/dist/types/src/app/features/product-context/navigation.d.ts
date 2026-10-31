import type { ProductNavigationRequest, ProductNavigationResolution } from "../../types/api";
export interface ProductNavigationAdapter {
    currentSession(): string | null;
    open(resolution: ProductNavigationResolution): boolean;
}
/** One runtime owns this explicit-action bridge. Nothing reads Markdown or
 * subscribes to answers. Connecting a browser never replays headless requests. */
export declare class ProductNavigation {
    private readonly resolve;
    private readonly closed;
    private adapter;
    private version;
    constructor(resolve: (request: ProductNavigationRequest) => Promise<ProductNavigationResolution>, closed: () => boolean);
    connect(adapter: ProductNavigationAdapter): () => void;
    close(): void;
    /** Call only for a user click or explicit navigation request. The server
     * validates build/session; the attached consumer validates visibility/view. */
    open(request: ProductNavigationRequest): Promise<ProductNavigationResolution>;
}
