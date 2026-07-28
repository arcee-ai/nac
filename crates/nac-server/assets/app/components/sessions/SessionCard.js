import { React, html } from "../../lib/html.js";
import { cn } from "../../lib/cn.js";
import { Icon } from "../../atoms/icon.js";
import { Loader, LoaderSize, LoaderVariant } from "../../atoms/loader.js";
import { Tooltip } from "../../atoms/tooltip.js";
import { SessionAvatar } from "../../atoms/session-avatar.js";
import { SessionCardActions } from "./SessionCardActions.js";
import {
  displaySessionTitle,
  formatClock,
  formatTokens,
  isActiveRun,
  sessionEnvLabel,
  sessionIdShort,
} from "../../lib/format.js";

const { useState, useEffect } = React;

function useRunClock(active, startedAt) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
  if (!active) return null;
  return formatClock(startedAt ? Date.now() - startedAt : 0);
}

// Figma ChatSessionCard has a full-bleed "Surface" layer below the content that
// carries the interaction state. Tokens are applied as CSS variables because the
// generated utilities in semantic.css have no group-hover/group-active variants.
const SURFACE_TOKENS = {
  default: "--color-bg-btn-ghost",
  hovered: "--color-bg-btn-ghost-hovered",
  pressed: "--color-bg-btn-ghost-pressed",
  selected: "--color-bg-btn-ghost-highlighted",
  selectedHovered: "--color-bg-btn-ghost-highlighted-hovered",
  selectedPressed: "--color-bg-btn-ghost-highlighted-pressed",
};

function surfaceToken({ selected, hover, pressed }) {
  if (pressed)
    return selected ? SURFACE_TOKENS.selectedPressed : SURFACE_TOKENS.pressed;
  if (hover)
    return selected ? SURFACE_TOKENS.selectedHovered : SURFACE_TOKENS.hovered;
  return selected ? SURFACE_TOKENS.selected : SURFACE_TOKENS.default;
}

function Metrics({ summary }) {
  const tokens = summary.total_tokens;
  return html`<div
    class="flex items-end justify-between w-full h-6 text-[11px] leading-[14px] whitespace-nowrap"
  >
    <div class="flex flex-wrap items-center gap-2.5 min-w-0">
      ${tokens == null
        ? null
        : html`<span class="text-info-primary"
            >${formatTokens(tokens)} Tokens</span
          >`}
    </div>
    <div
      class="flex flex-wrap items-center gap-2.5 text-basic-tertiary min-w-0"
    >
      <span class="font-bold">${sessionEnvLabel(summary)}</span>
      ${summary.model
        ? html`<span class="truncate">${summary.model}</span>`
        : null}
    </div>
  </div>`;
}

function IdBadge({ id, onCopy }) {
  return html`<div class="flex items-center gap-1.5 min-w-0">
    <span class="code code-small leading-4 text-basic-primary truncate">ID:${sessionIdShort(id)}</span>
    <${Tooltip} title="Copy session id" position="top-center" sticky=${true}>
      <button
        type="button"
        class="shrink-0 grid place-items-center p-1 rounded-[4px] text-basic-secondary hover:bg-btn-ghost-hovered hover:text-basic-primary"
        aria-label="Copy session id"
        onClick=${(e) => {
          e.stopPropagation();
          onCopy();
        }}
      >
        <${Icon} name="fileCopy" size=${16} />
      </button>
    </${Tooltip}>
  </div>`;
}

export function SessionCard({
  entry,
  selected,
  attention,
  onOpen,
  onTogglePin,
  onRename,
  onDelete,
  onStop,
  onCopyId,
}) {
  const s = entry.summary || entry;
  const id = s.session_id;
  const activeRun = entry.active_run || s.active_run;
  const running = isActiveRun(activeRun);
  const clock = useRunClock(
    running,
    activeRun && activeRun.started_at_epoch_ms,
  );
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);

  // The bottom row swaps metrics for the id + actions as soon as the card is
  // the user's focus, which is also how the design shows the Focused state.
  const showActions = hover || focused || selected;

  const activate = () => onOpen(id);
  const onKeyDown = (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
    }
  };

  return html`<div
    class=${cn(
      "group fade-up relative flex flex-col gap-4 px-6 py-5 rounded-[8px] overflow-hidden cursor-default",
      "bg-elevation-level-1 shadow-convex",
    )}
    role="button"
    tabindex="0"
    aria-pressed=${selected ? "true" : "false"}
    onClick=${activate}
    onKeyDown=${onKeyDown}
    onMouseEnter=${() => setHover(true)}
    onMouseLeave=${() => {
      setHover(false);
      setPressed(false);
    }}
    onFocus=${() => setFocused(true)}
    onBlur=${() => setFocused(false)}
    onPointerDown=${(e) => {
      // Inner controls own their pressed state, so the card surface stays calm.
      if (e.button === 0 && !e.target.closest("button, a, input, textarea"))
        setPressed(true);
    }}
    onPointerUp=${() => setPressed(false)}
    onPointerCancel=${() => setPressed(false)}
  >
    <div
      class="absolute inset-0 rounded-[8px] pointer-events-none ease-out"
      style=${{
        backgroundColor: `var(${surfaceToken({ selected, hover, pressed })})`,
      }}
    ></div>
    ${selected || focused
      ? html`<div
          class="absolute inset-0 rounded-[8px] pointer-events-none border-2"
          style=${{ borderColor: "var(--blue-500)" }}
        ></div>`
      : null}

    <div class="relative flex items-center gap-4 w-full">
      <${SessionAvatar} id=${id} size=${40} />
      <div class="flex flex-col gap-0.5 flex-1 min-w-0">
        <div class="flex items-center gap-1.5 w-full">
          ${s.pinned
            ? html`<${Icon}
                name="pin"
                size=${16}
                className="text-basic-secondary shrink-0"
              />`
            : null}
          ${attention
            ? html`<${Tooltip} title="Run finished" position="bottom-left" sticky=${true}>
                <span class="block w-2 h-2 rounded-full bg-accent-primary shrink-0"></span>
              </${Tooltip}>`
            : null}
          <div class="header-md text-basic-primary flex-1 min-w-0 truncate">
            ${displaySessionTitle(s)}
          </div>
          ${s.model_config_error
            ? html`<${Tooltip} title=${s.model_config_error} position="bottom-right" sticky=${true}>
                <${Icon} name="repair" size=${16} className="text-error-primary shrink-0" />
              </${Tooltip}>`
            : null}
          ${running
            ? html`<div class="flex items-center gap-1 shrink-0">
                <span class="text-basic-primary text-sm leading-5"
                  >${clock}</span
                >
                <${Loader}
                  size=${LoaderSize.Micro}
                  variant=${LoaderVariant.Neutral}
                />
              </div>`
            : null}
        </div>
        <div class="code code-micro text-basic-tertiary truncate w-full">
          ${typeof s.cwd === "string" ? s.cwd : ""}
        </div>
      </div>
    </div>

    <div class="relative w-full h-6">
      ${showActions
        ? html`<div class="flex items-end justify-between w-full h-6 gap-2">
            <${IdBadge} id=${id} onCopy=${() => onCopyId(id)} />
            <${SessionCardActions}
              pinned=${!!s.pinned}
              running=${running}
              onTogglePin=${() => onTogglePin(entry)}
              onRename=${() => onRename(entry)}
              onDelete=${() => onDelete(entry)}
              onStop=${() => onStop(entry)}
            />
          </div>`
        : html`<${Metrics} summary=${s} />`}
    </div>
  </div>`;
}
