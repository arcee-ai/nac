import { React, html } from "../../lib/html.js";
import { Modal, ModalSize } from "../../atoms/modal.js";
import { Button, ButtonVariant, ButtonContent } from "../../atoms/button.js";
import { deleteSession } from "../../store/sessionsStore.js";
import { clearSelection } from "../../store/selectionStore.js";
import { useToast } from "../../providers/ToastProvider.js";
import { displaySessionTitle, shortId } from "../../lib/format.js";

const { useState } = React;

export function DeleteModal({ open, onClose, entry }) {
  const summary = (entry && entry.summary) || {};
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteSession(summary.session_id);
      clearSelection();
      toast.success("Session deleted");
      onClose();
    } catch (e) {
      toast.error(`Failed to delete: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const footer = html`
    <${Button} variant=${ButtonVariant.Tertiary} content=${ButtonContent.Text} onClick=${onClose} disabled=${busy}>
      Cancel
    </${Button}>
    <${Button} variant=${ButtonVariant.SecondaryDestructive} content=${ButtonContent.Text} onClick=${submit} loading=${busy}>
      Delete session
    </${Button}>
  `;

  return html`<${Modal} open=${open} onClose=${onClose} title="Delete session" size=${ModalSize.Small} footer=${footer}>
    <p>
      Are you sure you want to delete the session
      <span class="text-basic-primary">"${displaySessionTitle(summary)}"</span>
      <span class="font-mono text-basic-muted">(${shortId(summary.session_id)})</span>?
      This action cannot be undone.
    </p>
  </${Modal}>`;
}
