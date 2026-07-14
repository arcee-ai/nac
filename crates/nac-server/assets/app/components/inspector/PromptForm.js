import { React, html } from "../../lib/html.js";
import { cn } from "../../lib/cn.js";
import { Icon } from "../../atoms/icon.js";
import { Button, ButtonVariant, ButtonContent } from "../../atoms/button.js";
import { api } from "../../services/api.js";
import { useToast } from "../../providers/ToastProvider.js";
import { loadSnapshot } from "../../store/sessionsStore.js";
import { useRunning } from "../../store/runtimeStore.js";

const { useState, useRef, useCallback } = React;

export function PromptForm({ id }) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const running = useRunning();
  const toast = useToast();
  const ref = useRef(null);

  const busy = sending || running;

  const submit = useCallback(async () => {
    const prompt = value.trim();
    if (!prompt || busy || !id) return;
    setSending(true);
    try {
      await api.submitRun(id, { prompt });
      setValue("");
      loadSnapshot(id); // user message appears; stream drives the rest
      if (ref.current) ref.current.style.height = "auto";
    } catch (e) {
      toast.error(`Failed to send: ${e.message}`);
    } finally {
      setSending(false);
    }
  }, [value, busy, id, toast]);

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onInput = (e) => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };

  return html`<form
    class="shrink-0 border-t border-primary p-3 flex items-end gap-2 bg-elevation-ground"
    onSubmit=${(e) => {
      e.preventDefault();
      submit();
    }}
  >
    <textarea
      ref=${ref}
      class=${cn(
        "input rounded-[8px] px-3 py-2 resize-none flex-grow font-normal leading-relaxed",
        "min-h-[44px] max-h-[200px]",
      )}
      rows=${1}
      placeholder=${running ? "Run in progress…" : "Type a message…  (Enter to send, Shift+Enter for newline)"}
      spellcheck="false"
      value=${value}
      disabled=${busy}
      onInput=${onInput}
      onKeyDown=${onKeyDown}
    ></textarea>
    <${Button}
      type="submit"
      variant=${ButtonVariant.Primary}
      content=${ButtonContent.Icon}
      loading=${busy}
      disabled=${!value.trim()}
      aria-label="Send"
    >
      <${Icon} name="arrowRight" />
    </${Button}>
  </form>`;
}
