import { Fragment } from "react";

import { Icon, IconName } from "@/app/atoms";
import { cn } from "@/app/lib/cn";

interface Crumb {
  label: string;
  path: string;
  home?: boolean;
}

/** Shown crumbs before the middle of a deep path folds into "…". */
const MAX_CRUMBS = 4;

function crumbsFor(path: string, home: string | null): Crumb[] {
  const homeRoot = home?.replace(/\/+$/, "") ?? "";
  const underHome = Boolean(homeRoot) && (path === homeRoot || path.startsWith(`${homeRoot}/`));
  const root: Crumb = underHome
    ? { label: "Home", path: homeRoot, home: true }
    : { label: "/", path: "/" };
  let trail = underHome ? homeRoot : "";
  const rest = (underHome ? path.slice(homeRoot.length) : path).split("/").filter(Boolean);
  return [
    root,
    ...rest.map((segment) => {
      trail = `${trail}/${segment}`;
      return { label: segment, path: trail };
    }),
  ];
}

/** The listed folder as a clickable trail: each step opens that folder. */
export function PathCrumbs({
  path,
  home,
  onOpen,
}: {
  path: string;
  home: string | null;
  onOpen: (path: string) => void;
}) {
  const all = crumbsFor(path, home);
  const folded = all.length > MAX_CRUMBS;
  const shown = folded ? [all[0], ...all.slice(-(MAX_CRUMBS - 1))] : all;
  return (
    <nav
      aria-label="Folder path"
      className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
    >
      {shown.map((crumb, index) => {
        const last = index === shown.length - 1;
        return (
          <Fragment key={crumb.path}>
            {index > 0 ? (
              <Icon iconName={IconName.Right} size={12} className="shrink-0 text-basic-muted" />
            ) : null}
            {folded && index === 1 ? (
              <>
                <span className="type-body-chrome shrink-0 px-1 text-basic-muted">…</span>
                <Icon iconName={IconName.Right} size={12} className="shrink-0 text-basic-muted" />
              </>
            ) : null}
            <button
              type="button"
              disabled={last}
              aria-current={last ? "location" : undefined}
              onClick={() => onOpen(crumb.path)}
              className={cn(
                "type-body-chrome flex h-8 min-w-0 items-center gap-1.5 rounded-md px-1.5 outline-none",
                "focus-visible:ring-2 focus-visible:ring-[var(--f-focus)]",
                last
                  ? "font-medium text-basic-primary"
                  : "shrink-0 text-basic-tertiary hover:bg-[var(--f-wash-1)] hover:text-basic-primary",
              )}
            >
              {crumb.home ? <Icon iconName={IconName.Home} size={14} className="shrink-0" /> : null}
              <span className="truncate">{crumb.label}</span>
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}
