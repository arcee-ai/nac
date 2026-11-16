import type { SkillCatalogEntry } from "../types/api";
export interface SkillReferenceSegment {
    text: string;
    skillName: string | null;
}
interface SkillReferenceQuery {
    start: number;
    end: number;
    entries: SkillCatalogEntry[];
}
/** Split prompt text around the exact references the backend registry will expand. */
export declare function skillReferenceSegments(value: string, entries: SkillCatalogEntry[]): SkillReferenceSegment[];
/** Find a catalog-backed `$prefix` ending at a collapsed textarea caret. */
export declare function skillReferenceQuery(value: string, selectionStart: number, selectionEnd: number, entries: SkillCatalogEntry[]): SkillReferenceQuery | null;
export {};
