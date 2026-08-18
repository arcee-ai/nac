import { cn } from "@/app/lib/cn";
import { FALLBACK_ICON, ICON_BY_EXTENSION, ICON_BY_FILE_NAME } from "./manifest.generated";

// Vendored by `npm run sync-file-icons`; the glob is eager so the icons are
// plain strings in the bundle rather than a hundred separate requests.
// SAFETY: the eager glob with `?raw` and `import: "default"` always yields
// string values keyed by the module path.
const sources = import.meta.glob("./icons/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const PREFIX = "./icons/";
const svgByIcon = new Map(
  Object.entries(sources).map(([file, svg]) => [file.slice(PREFIX.length, -".svg".length), svg]),
);

/**
 * The Material Icon Theme name for a path, matching a whole file name first so
 * `Dockerfile` and `Cargo.toml` beat their extensions, then the longest
 * extension so `main.spec.ts` beats a plain `.ts`.
 */
export function fileIconName(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();

  const exact = ICON_BY_FILE_NAME[name];
  if (exact) return exact;

  const parts = name.split(".");
  for (let index = 1; index < parts.length; index++) {
    const icon = ICON_BY_EXTENSION[parts.slice(index).join(".")];
    if (icon) return icon;
  }

  return FALLBACK_ICON;
}

// A file tree renders the same handful of icons over and over, so each one is
// encoded once and the browser then decodes it once per distinct URL.
const urls = new Map<string, string>();

const iconUrl = (icon: string): string => {
  const cached = urls.get(icon);
  if (cached) return cached;

  const svg = svgByIcon.get(icon) ?? svgByIcon.get(FALLBACK_ICON) ?? "";
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  urls.set(icon, url);
  return url;
};

/** The icon VS Code's Material theme gives a file, picked from its path. */
export default function FileIcon({
  path,
  size = 16,
  className,
}: {
  path: string;
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={iconUrl(fileIconName(path))}
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={cn("shrink-0", className)}
    />
  );
}
