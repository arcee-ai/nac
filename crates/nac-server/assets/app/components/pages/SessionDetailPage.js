import { html } from "../../lib/html.js";
import { Inspector } from "../Inspector.js";

// The session screen is the inspector at full width; navigation back to the
// list lives in the breadcrumb, so there is no chrome of its own here.
export function SessionDetailPage({ id, entry, onRename, onDelete, onSettings, onCancelRun }) {
  return html`<div class="h-full min-h-0">
    <${Inspector}
      id=${id}
      entry=${entry}
      onRename=${onRename}
      onDelete=${onDelete}
      onSettings=${onSettings}
      onCancelRun=${onCancelRun}
    />
  </div>`;
}
