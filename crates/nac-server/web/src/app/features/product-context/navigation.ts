import type {
  ProductContext,
  ProductNavigationRequest,
  ProductNavigationResolution,
} from "@/app/types/api";
import type {
  NotificationSessionTarget,
  SessionTargetOutcome,
} from "../desktop-commands/sessionTarget";

export interface ProductNavigationAdapter {
  currentSession(): string | null;
  open(resolution: ProductNavigationResolution): boolean;
  openNotificationSessionTarget?(sessionId: string): void;
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
    private readonly inspect?: (
      sessionId: string | null,
      signal?: AbortSignal,
    ) => Promise<ProductContext>,
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

  /** Reuse the normal full-chat lifecycle. It may resume already authorized
   * durable intent; this request carries no new intent or permission action. */
  async openNotificationSessionTarget(
    target: NotificationSessionTarget,
    signal: AbortSignal,
    canNavigate: () => boolean,
  ): Promise<SessionTargetOutcome> {
    const adapter = this.adapter;
    if (this.closed() || signal.aborted || !adapter?.openNotificationSessionTarget || !this.inspect)
      return "stale";
    if (!canNavigate()) return "deferred";
    const version = ++this.version;
    const source = adapter.currentSession();
    const current = await this.inspect(target.session_id, signal);
    if (
      this.closed() ||
      signal.aborted ||
      this.version !== version ||
      this.adapter !== adapter ||
      adapter.currentSession() !== source
    )
      return "stale";
    if (current.session?.session_id !== target.session_id) return "unavailable";
    if (!canNavigate()) return "deferred";
    adapter.openNotificationSessionTarget(target.session_id);
    return "opened";
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
    const assertView = () => {
      if (
        this.closed() ||
        this.version !== version ||
        this.adapter !== adapter ||
        (adapter && adapter.currentSession() !== session)
      )
        throw new Error("Product view changed; inspect capabilities again.");
    };
    assertView();
    if (
      resolution.build.build_id !== request.expected_build_id ||
      (resolution.session_id ?? null) !== requestedSession ||
      resolution.target.destination !== request.destination
    )
      throw new Error("Product destination binding changed.");
    if (!adapter || resolution.target.availability !== "available" || !this.inspect)
      return { ...resolution, opened: false };
    // A delayed receipt is not current serving authority. Re-read through this
    // runtime's bound transport before acting, then fence this additional await.
    const current = await this.inspect(requestedSession);
    assertView();
    if (
      current.build.build_id !== request.expected_build_id ||
      (current.session?.session_id ?? null) !== requestedSession ||
      !current.destinations.some(
        (target) =>
          target.destination === request.destination && target.availability === "available",
      )
    )
      throw new Error("Product destination binding changed.");
    const opened = adapter.open(resolution);
    return { ...resolution, opened };
  }
}
