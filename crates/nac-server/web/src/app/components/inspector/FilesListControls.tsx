import { useNativeRuntime } from "@/app/runtime/RuntimeContext";

import {
  ButtonVariant,
  HorizontalTabsItem,
  HorizontalTabsItemSize,
  Icon,
  IconName,
  StickyButton,
} from "@/app/atoms";
import { BranchPicker } from "@/app/components/inspector/BranchPicker";
import { CommitPopover } from "@/app/components/inspector/CommitPopover";
import { useIsMobile, useIsTablet } from "@/app/hooks/useMediaQuery";
import { type FileListing } from "@/app/store/sessionLayoutStore";
import type { ChangedFileStat } from "@/app/types/api";

/** The design's one-word labels, with names that say what each one lists. */
const LISTINGS: { listing: FileListing; label: string; name: string }[] = [
  { listing: "tree", label: "All", name: "All files" },
  { listing: "changed", label: "Diff", name: "Diff of changed files" },
];

/** How the files are listed, and the commit action. */
export function FilesListToolbar({
  sessionId,
  listing,
  changed,
  revision,
  readOnly,
}: {
  sessionId: string;
  listing: FileListing;
  changed: ChangedFileStat[];
  revision: number | null;
  readOnly: boolean;
}) {
  const { selectFileListing } = useNativeRuntime().stores.sessionLayoutStore;

  const isMobile = useIsMobile();
  const isTablet = useIsTablet();

  const commit = readOnly ? null : (
    <CommitPopover sessionId={sessionId} changed={changed} revision={revision} />
  );

  if (isMobile) {
    return (
      <div className="flex items-center gap-2">
        {LISTINGS.map((item) => (
          <StickyButton
            key={item.listing}
            variant={
              listing === item.listing ? ButtonVariant.GhostHighlighted : ButtonVariant.Ghost
            }
            aria-pressed={listing === item.listing}
            aria-label={item.name}
            onClick={() => selectFileListing(item.listing)}
          >
            {item.label}
          </StickyButton>
        ))}
        {commit}
      </div>
    );
  }

  const tabs = (
    <div className="flex flex-1 min-w-0 items-center gap-1">
      {LISTINGS.map((item) => (
        <HorizontalTabsItem
          key={item.listing}
          size={HorizontalTabsItemSize.Small}
          active={listing === item.listing}
          aria-pressed={listing === item.listing}
          aria-label={item.name}
          onClick={() => selectFileListing(item.listing)}
        >
          {item.label}
        </HorizontalTabsItem>
      ))}
    </div>
  );

  // A tablet's list header is already the bar, with the back button before it.
  if (isTablet) {
    return (
      <div className="flex flex-1 min-w-0 items-center gap-[10px] pr-2">
        {tabs}
        {commit}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 h-12 px-3 shrink-0 border-b border-muted @max-[560px]:gap-2 @max-[560px]:px-2">
      {tabs}
      {commit}
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
        <span className="label-micro flex min-w-0 items-center gap-1.5 py-1 pl-1 text-btn-secondary">
          <Icon iconName={IconName.Scheme} size={16} className="shrink-0" />
          <span className="truncate">{branch}</span>
        </span>
      ) : (
        <BranchPicker sessionId={sessionId} branch={branch} />
      )}
    </div>
  );
}
