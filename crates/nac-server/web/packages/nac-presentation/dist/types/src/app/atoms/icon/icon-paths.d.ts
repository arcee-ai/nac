export type IconPath = {
    kind: "path";
    d: string | readonly string[];
    fillRule?: "evenodd";
} | {
    kind: "glyph";
    viewBox: string;
    d: string | readonly string[];
    fillRule?: "evenodd";
};
export interface IconPathMap {
    [name: string]: IconPath;
}
export declare const iconPaths: IconPathMap;
