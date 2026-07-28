import { React, html } from "../../lib/html.js";
import { Modal, ModalSize } from "../../atoms/modal.js";
import { Input } from "../../atoms/input.js";
import { Button, ButtonVariant, ButtonContent } from "../../atoms/button.js";
import { renameSession } from "../../store/sessionsStore.js";
import { useToast } from "../../providers/ToastProvider.js";
import { displaySessionTitle } from "../../lib/format.js";

const { useState, useEffect } = React;

export function RenameModal({ open, onClose, entry }) {
  const summary = (entry && entry.summary) || {};
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(typeof summary.title === "string" ? summary.title : "");
      setPinned(!!summary.pinned);
      setBusy(false);
    }
  }, [open, summary.session_id]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await renameSession(summary.session_id, {
        title: title.trim(),
        pinned,
        expected_version: summary.presentation_version ?? 0,
      });
      toast.success("Session presentation saved");
      onClose();
    } catch (e) {
      const conflict = /HTTP 409/.test(e.message);
      toast.error(conflict ? "Version conflict — the session changed in the meantime" : `Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const footer = html`
    <${Button} variant=${ButtonVariant.Tertiary} content=${ButtonContent.Text} onClick=${onClose} disabled=${busy}>
      Cancel
    </${Button}>
    <${Button} variant=${ButtonVariant.Primary} content=${ButtonContent.Text} onClick=${submit} loading=${busy}>
      Save
    </${Button}>
  `;

  return html`<${Modal} open=${open} onClose=${onClose} title="Rename session" size=${ModalSize.Small} footer=${footer}>
    <div class="flex flex-col gap-4">
      <${Input}
        label="Title"
        placeholder=${displaySessionTitle(summary) || "Session name"}
        hintText="Leave empty to restore the automatic title (last prompt)."
        value=${title}
        onInput=${(e) => setTitle(e.target.value)}
        onKeyDown=${(e) => e.key === "Enter" && submit()}
      />
      <label class="flex items-center gap-2 label-small text-basic-secondary cursor-auto select-none">
        <input type="checkbox" checked=${pinned} onChange=${(e) => setPinned(e.target.checked)} class="accent-[var(--color-fill-accent-primary)]" />
        Pin to top of the list
      </label>
    </div>
  </${Modal}>`;
}
