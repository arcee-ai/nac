type RendererModule = typeof import("./markdown-renderer");
/**
 * Starts the renderer chunk, or joins the load already running. Shared with the
 * transcript, which holds its first paint back until this settles: until the
 * chunk lands every message renders as its own source in a `pre`, and a reveal
 * before that would show the whole conversation unformatted and then reflow it.
 */
export declare function loadMarkdownRenderer(): Promise<RendererModule>;
/** Whether markdown renders as prose right now, without waiting a frame. */
export declare function markdownRendererArrived(): boolean;
export {};
