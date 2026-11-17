import { useKeyboardShortcuts } from "@/app/hooks/useKeyboardShortcuts";
import { COMMAND_PALETTE_KEYS, SHORTCUT_SHEET_KEYS } from "@/app/lib/shortcuts";
import { CommandPalette } from "./CommandPalette";
import { useCommandSurfaceControls } from "./paletteSignal";
import { ShortcutSheet } from "./ShortcutSheet";

/**
 * The one owner of the ⌘K palette and the ⌘/ sheet: binds both chords and
 * renders whichever surface the shared signal names. Mounted once per
 * presentation, inside every provider, so it is available on every route.
 */
export function CommandSurfaces() {
  const { useCommandSurface, openCommandPalette, openShortcutSheet, closeCommandSurfaces } =
    useCommandSurfaceControls();
  const surface = useCommandSurface();
  useKeyboardShortcuts([
    { keys: COMMAND_PALETTE_KEYS, onTrigger: openCommandPalette },
    { keys: SHORTCUT_SHEET_KEYS, onTrigger: openShortcutSheet },
  ]);
  return (
    <>
      <CommandPalette open={surface === "palette"} onClose={closeCommandSurfaces} />
      <ShortcutSheet open={surface === "shortcuts"} onClose={closeCommandSurfaces} />
    </>
  );
}
