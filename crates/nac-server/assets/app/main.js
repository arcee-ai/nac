import { html } from "./lib/html.js";
import { ThemeProvider } from "./providers/ThemeProvider.js";
import { ToastProvider } from "./providers/ToastProvider.js";
import { AppShell } from "./components/AppShell.js";

const { createRoot } = window.ReactDOM;

function Root() {
  return html`<${ThemeProvider}><${ToastProvider}><${AppShell} /></${ToastProvider}></${ThemeProvider}>`;
}

createRoot(document.getElementById("root")).render(html`<${Root} />`);
