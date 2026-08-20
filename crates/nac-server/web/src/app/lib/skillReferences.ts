import type { SkillCatalogEntry } from "@/app/types/api";

const REFERENCE_CONTINUATION = /[\p{Alphabetic}\p{Number}_-]/u;

export interface SkillReferenceSegment {
  text: string;
  skillName: string | null;
}

interface SkillReferenceQuery {
  start: number;
  end: number;
  entries: SkillCatalogEntry[];
}

function characterAt(value: string, index: number): string | null {
  if (index >= value.length) return null;
  return value.slice(index)[Symbol.iterator]().next().value ?? null;
}

function hasReferenceBoundary(value: string, index: number): boolean {
  const next = characterAt(value, index);
  return next === null || !REFERENCE_CONTINUATION.test(next);
}

function namesLongestFirst(entries: SkillCatalogEntry[]): SkillCatalogEntry[] {
  return [...entries].sort(
    (left, right) => right.name.length - left.name.length || left.name.localeCompare(right.name),
  );
}

/** Split prompt text around the exact references the backend registry will expand. */
export function skillReferenceSegments(
  value: string,
  entries: SkillCatalogEntry[],
): SkillReferenceSegment[] {
  if (!value || entries.length === 0) return [{ text: value, skillName: null }];

  const catalog = namesLongestFirst(entries);
  const segments: SkillReferenceSegment[] = [];
  let plainStart = 0;
  let searchFrom = 0;

  for (;;) {
    const marker = value.indexOf("$", searchFrom);
    if (marker === -1) break;
    const referenceStart = marker + 1;
    const match = catalog.find(
      (entry) =>
        value.startsWith(entry.name, referenceStart) &&
        hasReferenceBoundary(value, referenceStart + entry.name.length),
    );
    if (!match) {
      searchFrom = referenceStart;
      continue;
    }

    if (marker > plainStart) {
      segments.push({ text: value.slice(plainStart, marker), skillName: null });
    }
    const end = referenceStart + match.name.length;
    segments.push({ text: value.slice(marker, end), skillName: match.name });
    plainStart = end;
    searchFrom = end;
  }

  if (plainStart < value.length || segments.length === 0) {
    segments.push({ text: value.slice(plainStart), skillName: null });
  }
  return segments;
}

/** Find a catalog-backed `$prefix` ending at a collapsed textarea caret. */
export function skillReferenceQuery(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  entries: SkillCatalogEntry[],
): SkillReferenceQuery | null {
  if (selectionStart === 0 || selectionStart !== selectionEnd || entries.length === 0) return null;
  if (!hasReferenceBoundary(value, selectionEnd)) return null;

  const maxNameLength = entries.reduce((length, entry) => Math.max(length, entry.name.length), 0);
  const earliest = Math.max(0, selectionStart - maxNameLength - 1);
  let marker = value.lastIndexOf("$", selectionStart - 1);
  let query: SkillReferenceQuery | null = null;

  while (marker >= earliest) {
    const prefix = value.slice(marker + 1, selectionStart);
    const foldedPrefix = prefix.toLocaleLowerCase();
    const matches = entries.filter((entry) =>
      entry.name.toLocaleLowerCase().startsWith(foldedPrefix),
    );
    if (matches.length > 0) {
      query = {
        start: marker,
        end: selectionStart,
        entries: matches,
      };
    }
    marker = marker === 0 ? -1 : value.lastIndexOf("$", marker - 1);
  }

  return query;
}
