import { useNativeRuntime } from "@/app/runtime/RuntimeContext";

import { Icon, IconName } from "@/app/atoms";
import { BranchPicker } from "@/app/components/inspector/BranchPicker";
import { CommitPopover } from "@/app/components/inspector/CommitPopover";
import { useIsMobile, useIsTablet } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { revisionOrdinal, revisionTitle } from "@/app/lib/revisions";
import { useWorkspaceRevisions } from "@/app/services/queries";
import { type FileListing } from "@/app/store/sessionLayoutStore";
import type { ChangedFileStat } from "@/app/types/api";

/** Short labels, with names that say what each one lists. */
const LISTINGS: { listing: FileListing; label: string; name: string }[] = [
  { listing: "changed", label: "Changed", name: "Diff of changed files" },
  { listing: "tree", label: "All", name: "All files" },
];

interface SegmentOption {
  key: string;
  label: string;
  /** The accessible name, when the visible label is shorter. */
  name?: string;
  title?: string;
}

/**
 * Two or three quiet pills inside a washed track, the selected one raised on
 * the surface. Each option is a toggle button so its name stays its own.
 */
function Segmented({
  label,
  options,
  value,
  large,
  onChange,
}: {
  label: string;
  options: SegmentOption[];
  value: string;
  large: boolean;
  onChange: (key: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex min-w-0 shrink-0 items-center gap-0.5 rounded-pill bg-[var(--f-wash-1)] p-0.5",
      )}
    >
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={selected}
            aria-label={option.name}
            title={option.title}
            onClick={() => onChange(option.key)}
            className={cn(
              "min-w-0 truncate rounded-pill transition-colors duration-150 ease-out",
              "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-border-focus-outline)]",
              large ? "h-10 px-4 type-label" : "h-6 px-2.5 type-meta-strong",
              selected
                ? "bg-elevation-level-1 text-basic-primary shadow-sm"
                : "text-basic-tertiary hover:text-basic-primary",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Which checkout the panel describes: the working tree against HEAD, or what
 * one finished run changed. Choosing a snapshot here opens the newest one
 * unless another is already selected; the session's revision picker and the
 * History panel share the same selection.
 */
export function FilesScopeToggle({
  sessionId,
  revision,
  large = false,
}: {
  sessionId: string;
  revision: number | null;
  large?: boolean;
}) {
  const { selectRevision } = useNativeRuntime().stores.sessionLayoutStore;
  const { data } = useWorkspaceRevisions(sessionId);
  const revisions = data ?? [];
  if (revisions.length === 0) return null;
  const index = revision == null ? 0 : revisions.findIndex((item) => item.id === revision);
  const shown = revisions[Math.max(0, index)];
  const title = revisionTitle(revisionOrdinal(Math.max(0, index), revisions.length));
  return (
    <Segmented
      label="Changes to show"
      large={large}
      value={revision == null ? "tree" : "revision"}
      options={[
        { key: "tree", label: "Working tree", title: "Every uncommitted change in the checkout" },
        {
          key: "revision",
          label: title,
          title: `What the run captured as ${title} changed`,
        },
      ]}
      onChange={(key) => selectRevision(key === "tree" ? null : (revision ?? shown.id))}
    />
  );
}

/** How the files are listed, which changes they show, and the commit action. */
export function FilesListToolbar({
  sessionId,
  listing,
  changed,
  revision,
  readOnly,
  reveal,
}: {
  sessionId: string;
  listing: FileListing;
  changed: ChangedFileStat[];
  revision: number | null;
  readOnly: boolean;
  reveal?: import("react").ReactNode;
}) {
  const { selectFileListing } = useNativeRuntime().stores.sessionLayoutStore;

  const isMobile = useIsMobile();
  const isTablet = useIsTablet();

  const commit = readOnly ? null : (
    <CommitPopover sessionId={sessionId} changed={changed} revision={revision} />
  );
  const tabs = (
    <Segmented
      label="List files"
      large={isMobile}
      value={listing}
      options={LISTINGS.map((item) => ({
        key: item.listing,
        label: item.label,
        name: item.name,
      }))}
      onChange={(key) => selectFileListing(key as FileListing)}
    />
  );
  // The same cached list the toggle reads; without snapshots there is no scope to pick.
  const hasRevisions = (useWorkspaceRevisions(sessionId).data?.length ?? 0) > 0;
  const scope = hasRevisions ? (
    <FilesScopeToggle sessionId={sessionId} revision={revision} large={isMobile} />
  ) : null;

  if (isMobile) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {tabs}
        {reveal}
        {commit}
        {scope}
      </div>
    );
  }

  // A tablet's list header is already the bar, with the back button before it.
  if (isTablet) {
    return (
      <div className="flex flex-1 min-w-0 items-center gap-2 pr-2">
        {tabs}
        <span className="flex-1" />
        {reveal}
        {commit}
      </div>
    );
  }

  return (
    <div className="flex flex-col shrink-0 gap-2 px-2 py-2 border-b border-tertiary">
      <div className="flex min-w-0 items-center gap-1.5">
        {tabs}
        <span className="flex-1" />
        {reveal}
        {commit}
      </div>
      {scope ? <div className="flex min-w-0">{scope}</div> : null}
    </div>
  );
}

/**
 * The checkout's branch, atop a phone's file list: the session header that
 * carries it on a wider screen is not drawn there. A delegated session only
 * names its branch, the way that header does.
 */
export function FilesBranchRow({
  sessionId,
  branch,
  readOnly,
}: {
  sessionId: string;
  branch: string;
  readOnly: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center px-2 pb-2">
      {readOnly ? (
        <span className="type-meta-strong flex min-w-0 items-center gap-1.5 py-1 pl-1 text-basic-secondary">
          <Icon iconName={IconName.Scheme} size={16} className="shrink-0" />
          <span className="truncate">{branch}</span>
        </span>
      ) : (
        <BranchPicker sessionId={sessionId} branch={branch} />
      )}
    </div>
  );
}
