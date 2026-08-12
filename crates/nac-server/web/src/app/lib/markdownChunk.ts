// The parser and the highlighter together outweigh the rest of the app, and
// nothing outside the inspector renders markdown, so they load on demand.
type RendererModule = typeof import("./markdown-renderer");

let chunk: Promise<RendererModule> | null = null;
let arrived = false;

/**
 * Starts the renderer chunk, or joins the load already running. Shared with the
 * transcript, which holds its first paint back until this settles: until the
 * chunk lands every message renders as its own source in a `pre`, and a reveal
 * before that would show the whole conversation unformatted and then reflow it.
 */
export function loadMarkdownRenderer(): Promise<RendererModule> {
  chunk ??= import("./markdown-renderer").then((module) => {
    arrived = true;
    return module;
  });
  return chunk;
}

/** Whether markdown renders as prose right now, without waiting a frame. */
export function markdownRendererArrived(): boolean {
  return arrived;
}
