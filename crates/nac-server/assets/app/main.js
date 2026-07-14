import { html } from "./lib/html.js";
import { cn } from "./lib/cn.js";
import { renderMarkdown } from "./lib/markdown.js";

const { createRoot } = window.ReactDOM;

// Minimal atom to prove htm + cn + Tailwind token utilities work together.
function Button({ variant = "primary", className, children, ...props }) {
  const base =
    "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors";
  const variants = {
    primary: "bg-btn-primary text-white hover:bg-btn-primary-hovered",
    ghost: "text-basic-secondary hover:bg-elevation-level-2",
  };
  return html`<button class=${cn(base, variants[variant], className)} ...${props}>${children}</button>`;
}

const SAMPLE = [
  "## Fundament działa",
  "",
  "To jest render **React + htm** stylowany **tokenami ArceeFM** i utility",
  "**Tailwind v4** kompilowanymi w przeglądarce — bez builda, bez Node.",
  "",
  "```js",
  "import { html } from './lib/html.js';",
  "root.render(html`<${App} />`);",
  "```",
].join("\n");

function App() {
  return html`
    <div class="h-screen flex flex-col">
      <header class="flex items-center justify-between px-4 h-14 border-b border-primary">
        <div class="header-small text-basic-primary">nac · next frontend</div>
        <div class="flex gap-2">
          <${Button} variant="ghost">Ustawienia</${Button}>
          <${Button} variant="primary">Nowa sesja</${Button}>
        </div>
      </header>
      <main class="flex-1 grid grid-cols-[340px_1fr] min-h-0">
        <aside class="border-r border-primary p-3 overflow-auto bg-elevation-ground">
          <div class="tag-label text-basic-muted mb-2">Sesje</div>
          ${[1, 2, 3].map(
            (i) => html`<div
              key=${i}
              class="fade-up mb-2 rounded-xl p-3 bg-elevation-level-1 border border-secondary text-basic-secondary hover:bg-elevation-level-2 cursor-pointer"
            >
              <div class="label-small text-basic-primary">Sesja ${i}</div>
              <div class="text-micro text-basic-muted">placeholder karty</div>
            </div>`,
          )}
        </aside>
        <section class="p-6 overflow-auto bg-elevation-level-0-5">
          <div class="fade max-w-2xl rounded-2xl p-5 bg-elevation-level-1 border border-secondary shadow-convex">
            <div class="header-medium text-basic-primary mb-1">Step 1 — design system</div>
            <div class="label-micro text-shimmer-accent mb-3">tokeny · typografia · animacje · fonty</div>
            <div class="markdown paragraph-medium text-basic-secondary">
              ${renderMarkdown(SAMPLE)}
            </div>
          </div>
        </section>
      </main>
    </div>
  `;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
