import { type PaletteGroup, type PaletteItem } from "./usePaletteCommands";
export interface PaletteSection {
    group: PaletteGroup;
    items: PaletteItem[];
}
/**
 * Filter and order the palette. With no query: recent top-level sessions,
 * the open session's panels, then actions and settings. With a query: every
 * item that fuzzy-matches (subagents included), best groups first.
 */
export declare function filterPalette(items: PaletteItem[], query: string): PaletteSection[];
