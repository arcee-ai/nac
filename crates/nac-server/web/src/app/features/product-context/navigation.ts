import type { ProductNavigationRequest, ProductNavigationResolution } from "@/app/types/api";

export interface ProductNavigationAdapter {
  currentSession(): string | null;
  open(resolution: ProductNavigationResolution): boolean;
}

/** One runtime owns this explicit-action bridge. Nothing reads Markdown or
 * subscribes to answers. Connecting a browser never replays headless requests. */
export class ProductNavigation {
  private adapter: ProductNavigationAdapter | undefined;
  private version = 0;
  constructor(
    private readonly resolve: (
      request: ProductNavigationRequest,
    ) => Promise<ProductNavigationResolution>,
    private readonly closed: () => boolean,
  ) {}

  connect(adapter: ProductNavigationAdapter): () => void {
    this.adapter = adapter;
    this.version++;
    return () => {
      if (this.adapter === adapter) {
        this.adapter = undefined;
        this.version++;
      }
    };
  }

  close(): void {
    this.adapter = undefined;
    this.version++;
  }

  /** Call only for a user click or explicit navigation request. The server
   * validates build/session; the attached consumer validates visibility/view. */
  async open(request: ProductNavigationRequest): Promise<ProductNavigationResolution> {
    if (this.closed()) throw new Error("Product runtime is closed.");
    const adapter = this.adapter;
    const version = ++this.version;
    const session = adapter?.currentSession();
    const requestedSession = request.session_id ?? null;
    if (adapter && requestedSession !== session)
      throw new Error("Product destination belongs to another session.");
    const resolution = await this.resolve(request);
    if (
      this.closed() ||
      this.version !== version ||
      this.adapter !== adapter ||
      (adapter && adapter.currentSession() !== session)
    )
      throw new Error("Product view changed; inspect capabilities again.");
    if (
      resolution.build.build_id !== request.expected_build_id ||
      (resolution.session_id ?? null) !== requestedSession ||
      resolution.target.destination !== request.destination
    )
      throw new Error("Product destination binding changed.");
    const opened = resolution.target.availability === "available" && !!adapter?.open(resolution);
    return { ...resolution, opened };
  }
}
