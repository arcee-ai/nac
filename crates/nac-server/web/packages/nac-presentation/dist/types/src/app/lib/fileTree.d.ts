/** A row in the tree: every project file, with its git status when it has one. */
export interface FileNode {
    path: string;
    /** Porcelain status letter, or null for a file that matches HEAD. */
    status: string | null;
    additions: number | null;
    deletions: number | null;
}
export interface FileTreeDir {
    /** Segment(s) shown on the row; a merged chain keeps its slashes. */
    name: string;
    /** Full path of the deepest merged directory, used as the collapse key. */
    path: string;
    dirs: FileTreeDir[];
    files: FileNode[];
    /** Something below this directory has changed, so it is worth opening. */
    hasChanges: boolean;
}
/** Name to show on a leaf row, keeping the slash that marks a directory. */
export declare function fileLabel(path: string): string;
export declare function buildFileTree(files: FileNode[]): FileTreeDir;
/** Directories worth opening on arrival: the ones leading to a change. */
export declare function changedDirPaths(dir: FileTreeDir, into?: string[]): string[];
