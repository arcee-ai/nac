// Live reload driven by the dev server's `/__dev/events` stream.
//
// CSS-only changes swap the stylesheet link in place, which keeps app state.
// Anything else forces a reload: ES modules are cached per URL, so there is no
// way to hot-swap a component without a bundler.

const EVENTS_URL = "/__dev/events";

export function startLiveReload(overlay) {
  let connectedBefore = false;
  const source = new EventSource(EVENTS_URL);

  source.addEventListener("ready", () => {
    // A second `ready` means the dev server restarted, so the page is stale.
    if (connectedBefore) {
      window.location.reload();
      return;
    }
    connectedBefore = true;
    overlay.setStatus("dev", "ok");
  });

  source.addEventListener("change", (event) => {
    const paths = parsePaths(event.data);
    if (paths.length === 0) return;
    if (paths.every((path) => path.endsWith(".css"))) {
      paths.forEach(swapStylesheet);
      overlay.toast(paths.length === 1 ? `css ${paths[0]}` : `css ${paths.length} files`);
      return;
    }
    window.location.reload();
  });

  source.addEventListener("error", () => {
    overlay.setStatus("reconnecting", "warn");
  });
}

function parsePaths(data) {
  try {
    const payload = JSON.parse(data || "{}");
    return Array.isArray(payload.paths) ? payload.paths : [];
  } catch (_) {
    return [];
  }
}

function swapStylesheet(path) {
  const links = document.querySelectorAll('link[rel="stylesheet"]');
  for (const link of links) {
    const href = link.getAttribute("href") || "";
    const [base] = href.split("?");
    if (!base.endsWith(`/${path}`)) continue;
    link.setAttribute("href", `${base}?dev=${Date.now()}`);
  }
}
