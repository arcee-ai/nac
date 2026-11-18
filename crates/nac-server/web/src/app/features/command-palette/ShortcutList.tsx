import { useId } from "react";

import { KeyboardShortcut } from "@/app/atoms";
import { useNativeMenu } from "@/app/features/desktop-commands/nativeMenu";
import { SHORTCUT_GROUPS, shortcutsFor, type ShortcutEntry } from "@/app/lib/shortcuts";
import { cn } from "@/app/lib/cn";

function Keys({ entry }: { entry: ShortcutEntry }) {
  return (
    <KeyboardShortcut
      keys={entry.keys}
      spelled={entry.spelled}
      className="shrink-0 [&>kbd]:h-6 [&>kbd]:min-w-6 [&>kbd]:rounded-md [&>kbd]:border-tertiary [&>kbd]:bg-[var(--f-wash-1)] [&>kbd]:px-1.5 [&>kbd]:text-xs [&>kbd]:text-basic-secondary"
    />
  );
}

function Group({ name, entries }: { name: string; entries: ShortcutEntry[] }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      <h3 id={headingId} className="type-strong px-1 text-basic-primary">
        {name}
      </h3>
      <ul className="flex min-w-0 flex-col divide-y divide-[var(--f-line-soft)] overflow-hidden rounded-card border border-tertiary bg-elevation-level-1">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="type-body-chrome flex min-h-11 items-center justify-between gap-4 px-4 py-2 text-basic-primary"
          >
            <span className="min-w-0">{entry.label}</span>
            <Keys entry={entry} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The single shortcut catalog, grouped. Used by the ⌘/ sheet and Settings › Shortcuts. */
export function ShortcutList({ className }: { className?: string }) {
  const shortcuts = shortcutsFor(useNativeMenu());
  return (
    <div className={cn("flex min-w-0 flex-col gap-6", className)}>
      {SHORTCUT_GROUPS.map((group) => {
        const entries = shortcuts.filter((entry) => entry.group === group);
        return entries.length ? <Group key={group} name={group} entries={entries} /> : null;
      })}
    </div>
  );
}
