// Groups the flat list of project paths into the folder tree the Files panel
// shows. Directories with a single child and no files of their own are merged
// into one row, the way editors collapse `a/b/c` when nothing branches.

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

interface MutableDir {
  name: string;
  path: string;
  dirs: Map<string, MutableDir>;
  files: FileNode[];
}

/** git reports an untracked directory as one entry with a trailing slash. */
const isDirEntry = (path: string) => path.endsWith("/");

/** Name to show on a leaf row, keeping the slash that marks a directory. */
export function fileLabel(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const base = trimmed.split("/").pop() || trimmed;
  return isDirEntry(path) ? `${base}/` : base;
}

const emptyDir = (name: string, path: string): MutableDir => ({
  name,
  path,
  dirs: new Map(),
  files: [],
});

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

function freeze(dir: MutableDir): FileTreeDir {
  let current = dir;
  let name = dir.name;
  while (current.files.length === 0 && current.dirs.size === 1) {
    const [child] = current.dirs.values();
    name = `${name}/${child.name}`;
    current = child;
  }
  const dirs = [...current.dirs.values()].map(freeze).sort(byName);
  const files = current.files.slice().sort((a, b) => a.path.localeCompare(b.path));
  return {
    name,
    path: current.path,
    dirs,
    files,
    hasChanges: files.some((file) => file.status) || dirs.some((child) => child.hasChanges),
  };
}

export function buildFileTree(files: FileNode[]): FileTreeDir {
  const root = emptyDir("", "");

  for (const file of files) {
    const segments = file.path.replace(/\/+$/, "").split("/");
    segments.pop();
    let node = root;
    let prefix = "";
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let next = node.dirs.get(segment);
      if (!next) {
        next = emptyDir(segment, prefix);
        node.dirs.set(segment, next);
      }
      node = next;
    }
    node.files.push(file);
  }

  // The root is never rendered, so merging it away would hide the shared
  // prefix; only its children collapse.
  const dirs = [...root.dirs.values()].map(freeze).sort(byName);
  const rootFiles = root.files.slice().sort((a, b) => a.path.localeCompare(b.path));
  return {
    name: "",
    path: "",
    dirs,
    files: rootFiles,
    hasChanges: rootFiles.some((file) => file.status) || dirs.some((child) => child.hasChanges),
  };
}

/** Directories worth opening on arrival: the ones leading to a change. */
export function changedDirPaths(dir: FileTreeDir, into: string[] = []): string[] {
  for (const child of dir.dirs) {
    if (!child.hasChanges) continue;
    into.push(child.path);
    changedDirPaths(child, into);
  }
  return into;
}
