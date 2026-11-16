const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

/**
 * The platform's command modifier, named as a key so a shortcut can be declared
 * once and both matched and drawn from the same list.
 */
export const MOD = isMac ? "meta" : "ctrl";

/** Names accepted in a shortcut, drawn as the glyph the platform uses. */
interface KeyGlyphMap {
  [name: string]: string;
}

const GLYPHS: KeyGlyphMap = {
  ctrl: isMac ? "⌘" : "⌃",
  control: isMac ? "⌘" : "⌃",
  cmd: "⌘",
  command: "⌘",
  meta: isMac ? "⌘" : "⊞",
  shift: "⇧",
  alt: isMac ? "⌥" : "Alt",
  option: isMac ? "⌥" : "Alt",
  enter: "⏎",
  return: "⏎",
  esc: "⎋",
  escape: "⎋",
  tab: "⇥",
  delete: "⌫",
  backspace: "⌫",
  space: "␣",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
};

export const keyGlyph = (key: string): string => GLYPHS[key.toLowerCase()] ?? key.toUpperCase();

const MODIFIERS = new Set(["ctrl", "control", "meta", "cmd", "command", "alt", "option"]);

/** Whether a shortcut is one the browser would not have delivered on its own. */
export const hasModifier = (keys: string[]): boolean =>
  keys.some((key) => MODIFIERS.has(key.toLowerCase()));

const normalize = (key: string): string => {
  const lower = key.toLowerCase();
  if (lower === "control") return "ctrl";
  if (lower === "cmd" || lower === "command") return "meta";
  if (lower === "option") return "alt";
  return lower;
};

/**
 * Whether `event` is exactly `keys` — no more modifiers than were asked for, so
 * ⌘⇧O does not also fire what ⌘O is bound to.
 */
export function matchesShortcut(event: KeyboardEvent, keys: string[]): boolean {
  const pressed = new Set<string>();
  if (event.ctrlKey) pressed.add("ctrl");
  if (event.metaKey) pressed.add("meta");
  if (event.altKey) pressed.add("alt");
  if (event.shiftKey) pressed.add("shift");
  if (event.key) pressed.add(event.key.toLowerCase());
  const wanted = new Set(keys.map(normalize));
  return pressed.size === wanted.size && [...wanted].every((key) => pressed.has(key));
}

/**
 * Opens the new-project dialog. ⌘⇧O rather than ⌘N, which a browser keeps for
 * its own window and never hands to the page.
 */
export const NEW_PROJECT_KEYS = [MOD, "shift", "o"];

/**
 * Starts a session in the open project. Deliberately the same chord as
 * `NEW_PROJECT_KEYS`: the two never apply at once, so "make me a new one" stays
 * one gesture whose meaning follows whatever the page is showing.
 */
export const NEW_CHAT_KEYS = NEW_PROJECT_KEYS;
/** Focus vocabulary for the same chord. */
export const NEW_SESSION_IN_PROJECT_KEYS = NEW_PROJECT_KEYS;

/** The ⌘K command palette: sessions, projects, actions and settings. */
export const COMMAND_PALETTE_KEYS = [MOD, "k"];
/** The ⌘/ sheet that lists this catalog. */
export const SHORTCUT_SHEET_KEYS = [MOD, "/"];
/**
 * A new session. Browsers keep ⌘N for a window, so on the web this chord is
 * delivered only by the native shell's menu; the palette offers the same act.
 */
export const NEW_SESSION_KEYS = [MOD, "n"];
/** Show or hide the session sidebar. */
export const TOGGLE_SIDEBAR_KEYS = [MOD, "b"];
/** Pin the open drawer as a side column, or float it again. */
export const DOCK_DRAWER_KEYS = [MOD, "\\"];

export type ShortcutGroup = "General" | "Navigation" | "Session" | "Attention card";

export interface ShortcutEntry {
  id: string;
  /** Keys by name, drawn with `keyGlyph`; a bare key such as "1–9" is spelled. */
  keys: string[];
  label: string;
  group: ShortcutGroup;
  /** Shown as written rather than as glyphs (ranges such as 1–9). */
  spelled?: boolean;
}

/**
 * The one catalog of the app's shortcuts. The ⌘/ sheet and Settings ›
 * Shortcuts draw from it, and bindings import their chords from the constants
 * above so what is drawn and what is matched cannot drift apart.
 */
export const SHORTCUTS: readonly ShortcutEntry[] = [
  {
    id: "palette",
    keys: COMMAND_PALETTE_KEYS,
    label: "Open the command palette",
    group: "General",
  },
  {
    id: "shortcuts",
    keys: SHORTCUT_SHEET_KEYS,
    label: "Show keyboard shortcuts",
    group: "General",
  },
  {
    id: "close",
    keys: ["Esc"],
    label: "Close a dialog, drawer or palette",
    group: "General",
    spelled: true,
  },
  { id: "new-session", keys: NEW_SESSION_KEYS, label: "New session", group: "Navigation" },
  {
    id: "new-in-project",
    keys: NEW_SESSION_IN_PROJECT_KEYS,
    label: "New session in this project (new project elsewhere)",
    group: "Navigation",
  },
  { id: "sidebar", keys: TOGGLE_SIDEBAR_KEYS, label: "Toggle the sidebar", group: "Navigation" },
  { id: "dock", keys: DOCK_DRAWER_KEYS, label: "Dock or float the drawer", group: "Session" },
  { id: "approve", keys: ["enter"], label: "Approve the request", group: "Attention card" },
  { id: "deny", keys: ["d"], label: "Deny the request", group: "Attention card" },
  {
    id: "answer",
    keys: ["1–9"],
    label: "Pick an answer option",
    group: "Attention card",
    spelled: true,
  },
];

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  "General",
  "Navigation",
  "Session",
  "Attention card",
];
