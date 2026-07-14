import { html } from "../../lib/html.js";
import { Transcript } from "./Transcript.js";
import { PromptForm } from "./PromptForm.js";

export function ChatTab({ id }) {
  return html`<div class="flex flex-col h-full min-h-0">
    <${Transcript} id=${id} />
    <${PromptForm} id=${id} />
  </div>`;
}
