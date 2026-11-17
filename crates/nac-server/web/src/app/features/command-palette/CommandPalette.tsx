import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Icon, IconName, KeyboardShortcut, Modal, StatusDot } from "@/app/atoms";
import { useExitTransition } from "@/app/hooks/useExitTransition";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { filterPalette } from "./paletteFilter";
import { usePaletteCommands, type PaletteItem } from "./usePaletteCommands";

function Row({
  item,
  id,
  active,
  touch,
  onPick,
  onHover,
}: {
  item: PaletteItem;
  id: string;
  active: boolean;
  touch: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      data-active={active || undefined}
      // Keep focus in the field: a click picks without moving the caret.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPick}
      onMouseMove={onHover}
      className={cn(
        "flex min-w-0 cursor-default select-none items-center gap-3 rounded-md px-3 text-basic-secondary",
        touch ? "min-h-11 py-2" : "h-9",
        active && "bg-[var(--f-wash-2)] text-basic-primary",
        item.child && "pl-8",
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {item.status ? (
          <StatusDot status={item.status} size="md" />
        ) : item.icon ? (
          <Icon iconName={item.icon} size={16} className="text-basic-tertiary" />
        ) : null}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span
          className={cn(
            "truncate text-basic-primary",
            touch ? "type-body-chrome text-md" : "type-body-chrome",
          )}
        >
          {item.label}
        </span>
        {item.detail ? (
          <span className="type-meta min-w-0 truncate text-basic-tertiary">{item.detail}</span>
        ) : null}
      </span>
      {item.current ? (
        <Icon iconName={IconName.Check} size={14} className="shrink-0 text-basic-secondary" />
      ) : null}
      {item.shortcut && !touch ? (
        <KeyboardShortcut keys={item.shortcut} className="shrink-0 opacity-80" />
      ) : null}
    </div>
  );
}

/**
 * The palette's contents. Mounted only while open, so its queries and the
 * typed filter start fresh each time.
 */
function PaletteBody({ onClose }: { onClose: () => void }) {
  const isMobile = useIsMobile();
  const items = usePaletteCommands();
  const [query, setQuery] = useState("");
  const sections = useMemo(() => filterPalette(items, query), [items, query]);
  const flat = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (item: PaletteItem) => `${baseId}-${item.id}`;
  // The highlighted row follows the filter: the top match until the user moves.
  const active = flat.find((item) => item.id === activeId) ?? flat[0] ?? null;

  useEffect(() => {
    // Typing is the point of opening the palette, so the field takes focus,
    // after the dialog has focused its own card.
    const timer = window.setTimeout(() => field.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!active) return;
    const node = list.current?.ownerDocument.getElementById(optionId(active));
    node?.scrollIntoView?.({ block: "nearest" });
    // optionId is derived from a stable id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const pick = (item: PaletteItem) => {
    onClose();
    // Let the palette hand focus back before the command moves it on.
    window.setTimeout(() => item.run(), 0);
  };

  const move = (delta: number) => {
    if (flat.length === 0) return;
    const index = active ? flat.indexOf(active) : -1;
    const next = flat[(index + delta + flat.length) % flat.length];
    setActiveId(next.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")) {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")) {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home" && flat.length && !query) {
      event.preventDefault();
      setActiveId(flat[0].id);
    } else if (event.key === "End" && flat.length && !query) {
      event.preventDefault();
      setActiveId(flat[flat.length - 1].id);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active) pick(active);
    }
  };

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden text-basic-primary",
        isMobile
          ? "h-full bg-elevation-ground pt-[env(safe-area-inset-top)]"
          : "max-h-[min(560px,calc(100vh-20vh))] rounded-sheet border border-tertiary bg-elevation-level-3 shadow-2xl",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-2.5 border-b border-tertiary",
          isMobile ? "h-14 px-4" : "h-[52px] px-4",
        )}
      >
        <Icon iconName={IconName.Search} size={16} className="shrink-0 text-basic-tertiary" />
        <input
          ref={field}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active ? optionId(active) : undefined}
          aria-label="Search commands"
          placeholder="Search sessions, projects, settings…"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveId(null);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-basic-primary outline-none placeholder:text-basic-muted",
            isMobile ? "text-base" : "text-md",
          )}
        />
        {isMobile ? (
          <button
            type="button"
            onClick={onClose}
            className="type-label -mr-2 inline-flex h-11 shrink-0 items-center rounded-pill px-3 text-basic-secondary active:bg-[var(--f-wash-2)]"
          >
            Cancel
          </button>
        ) : (
          <kbd className="type-tag shrink-0 rounded-md border border-tertiary px-1.5 py-0.5 text-basic-tertiary">
            esc
          </kbd>
        )}
      </div>
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label="Commands"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
      >
        {sections.length === 0 ? (
          <p role="status" className="type-body-chrome px-3 py-6 text-center text-basic-tertiary">
            No results for “{query.trim()}”
          </p>
        ) : (
          sections.map((section) => (
            <div
              key={section.group}
              role="group"
              aria-labelledby={`${baseId}-group-${section.group}`}
              className="flex flex-col pb-1.5 last:pb-0"
            >
              <div
                id={`${baseId}-group-${section.group}`}
                role="presentation"
                className="type-meta-strong px-3 pb-1 pt-2 text-basic-tertiary"
              >
                {section.group}
              </div>
              {section.items.map((item) => (
                <Row
                  key={item.id}
                  id={optionId(item)}
                  item={item}
                  active={item === active}
                  touch={isMobile}
                  onPick={() => pick(item)}
                  onHover={() => {
                    if (item !== active) setActiveId(item.id);
                  }}
                />
              ))}
            </div>
          ))
        )}
      </div>
      {isMobile ? null : (
        <div className="type-meta flex shrink-0 items-center gap-4 border-t border-tertiary px-4 py-2 text-basic-tertiary">
          <span className="flex items-center gap-1.5">
            <KeyboardShortcut keys={["up"]} />
            <KeyboardShortcut keys={["down"]} />
            to move
          </span>
          <span className="flex items-center gap-1.5">
            <KeyboardShortcut keys={["enter"]} />
            to open
          </span>
        </div>
      )}
    </div>
  );
}

/** The ⌘K command palette: one field over everything the app can go to or do. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Kept through the phone's exit slide; a fresh open starts a fresh filter.
  const mounted = useExitTransition(open);
  return mounted ? <PaletteModal open={open} onClose={onClose} /> : null;
}

function PaletteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const isMobile = useIsMobile();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Command palette"
      chromeless
      hideClose
      zIndex={140}
      className={cn(!isMobile && "mt-[12vh] max-w-[640px] self-start")}
    >
      <PaletteBody onClose={onClose} />
    </Modal>
  );
}
