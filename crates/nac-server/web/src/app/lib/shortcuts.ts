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
 * Starts an Agent chat in the open project. Deliberately the same chord as
 * `NEW_PROJECT_KEYS`: the two never apply at once, so "make me a new one" stays
 * one gesture whose meaning follows whatever the page is showing.
 */
export const NEW_CHAT_KEYS = NEW_PROJECT_KEYS;
