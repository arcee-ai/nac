import { bestScore } from "./fuzzy";
import { PALETTE_GROUPS, type PaletteGroup, type PaletteItem } from "./usePaletteCommands";

export interface PaletteSection {
  group: PaletteGroup;
  items: PaletteItem[];
}

/** How many rows a long group shows before the user narrows it down. */
const IDLE_LIMIT: Partial<Record<PaletteGroup, number>> = {
  Sessions: 6,
  Projects: 5,
  "New session in…": 0,
};
const QUERY_LIMIT: Partial<Record<PaletteGroup, number>> = {
  Sessions: 12,
  Projects: 6,
  "New session in…": 4,
};

/**
 * Filter and order the palette. With no query: recent top-level sessions,
 * the open session's panels, then actions and settings. With a query: every
 * item that fuzzy-matches (subagents included), best groups first.
 */
export function filterPalette(items: PaletteItem[], query: string): PaletteSection[] {
  const needle = query.trim();
  const sections: (PaletteSection & { best: number; order: number })[] = [];
  PALETTE_GROUPS.forEach((group, order) => {
    const members = items.filter((item) => item.group === group);
    if (!needle) {
      const visible = members.filter((item) => !item.child);
      const limit = IDLE_LIMIT[group];
      const kept = limit === undefined ? visible : visible.slice(0, limit);
      if (kept.length) sections.push({ group, items: kept, best: 0, order });
      return;
    }
    const scored = members
      .map((item) => ({
        item,
        score: bestScore(
          needle,
          item.label,
          [item.detail, item.keywords].filter(Boolean).join(" "),
        ),
      }))
      .filter((entry): entry is { item: PaletteItem; score: number } => entry.score !== null)
      .sort(
        (left, right) =>
          right.score - left.score || (right.item.recency ?? 0) - (left.item.recency ?? 0),
      );
    const limit = QUERY_LIMIT[group];
    const kept = (limit === undefined ? scored : scored.slice(0, limit)).map((entry) => entry.item);
    if (kept.length) sections.push({ group, items: kept, best: scored[0].score, order });
  });
  if (needle) sections.sort((left, right) => right.best - left.best || left.order - right.order);
  return sections.map(({ group, items: kept }) => ({ group, items: kept }));
}
