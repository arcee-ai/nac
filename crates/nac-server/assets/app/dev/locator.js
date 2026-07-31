// Stamps `data-locator="<file>:<line>"` onto every rendered element in dev mode,
// so the source of anything is readable straight from the Elements panel.
//
// Locator.js proper does this with a Babel transform, and its extension refuses
// to run against a production React build. With no build step the source has to
// be recovered at runtime: walk the React fiber tree for the owning component
// (function names survive because our own modules are unminified) and resolve the
// name against the declaration index the dev server builds from `assets/app/**`.

const INDEX_URL = "/__dev/components";
const STATUS_URL = "/__dev/status";
const ATTRIBUTE = "data-locator";
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "META", "TITLE", "HEAD"]);

let componentIndex = {};
let sourcePrefix = "";

export async function startLocator() {
  await loadSources();
  annotate(document.body);
  // React mounts asynchronously and keeps swapping subtrees, so new nodes are
  // annotated as they arrive.
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) annotate(node);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

async function loadSources() {
  try {
    const [index, status] = await Promise.all([
      fetch(INDEX_URL).then((response) => response.json()),
      fetch(STATUS_URL).then((response) => response.json()),
    ]);
    componentIndex = index.components || {};
    sourcePrefix = status.source_prefix || "";
  } catch (error) {
    console.warn("nac dev: component index unavailable", error);
  }
}

function annotate(root) {
  if (root.closest("[data-nac-dev]")) return;
  for (const node of [root, ...root.querySelectorAll("*")]) {
    if (node.hasAttribute(ATTRIBUTE) || SKIP_TAGS.has(node.tagName)) continue;
    const source = sourceOf(node);
    if (source) node.setAttribute(ATTRIBUTE, source);
  }
}

// The nearest enclosing component of the host fiber for this DOM node.
function sourceOf(node) {
  let fiber = fiberOf(node);
  while (fiber) {
    const name = typeName(fiber.type);
    if (name && /^[A-Z]/.test(name)) {
      const candidates = componentIndex[name];
      if (candidates && candidates.length > 0) {
        const { file, line } = candidates[0];
        return `${sourcePrefix ? `${sourcePrefix}/` : ""}${file}:${line}`;
      }
      return null;
    }
    fiber = fiber.return;
  }
  return null;
}

function fiberOf(node) {
  const key = Object.keys(node).find(
    (candidate) =>
      candidate.startsWith("__reactFiber$") || candidate.startsWith("__reactInternalInstance$"),
  );
  return key ? node[key] : null;
}

// Unwraps memo/forwardRef wrappers, which carry the component on `.type`/`.render`.
function typeName(type, depth = 0) {
  if (!type || depth > 3) return null;
  if (typeof type === "function") return type.displayName || type.name || null;
  if (typeof type === "object") return typeName(type.type || type.render, depth + 1);
  return null;
}
