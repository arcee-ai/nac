// Entry point for the dev-only tooling. Dev servers (`nac-web --dev` and
// scripts/dev-server.py) inject a script tag for this module, so a normal run
// never loads anything under `app/dev/`.

import { createOverlay } from "./overlay.js";
import { startLiveReload } from "./live-reload.js";
import { startLocator } from "./locator.js";

const overlay = createOverlay();
overlay.setStatus("dev", "ok");
startLiveReload(overlay);
startLocator();

console.info(
  [
    "nac dev mode",
    "  live reload: css swaps in place, other edits reload the page",
    "  locator: every element carries data-locator=\"<file>:<line>\"",
  ].join("\n"),
);
