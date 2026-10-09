/**
 * The Material Icon Theme name for a path, matching a whole file name first so
 * `Dockerfile` and `Cargo.toml` beat their extensions, then the longest
 * extension so `main.spec.ts` beats a plain `.ts`.
 */
export declare function fileIconName(path: string): string;
/** The icon VS Code's Material theme gives a file, picked from its path. */
export default function FileIcon({ path, size, className, }: {
    path: string;
    size?: number;
    className?: string;
}): import("react").JSX.Element;
