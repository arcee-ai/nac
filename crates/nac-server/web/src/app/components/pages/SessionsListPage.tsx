import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  BoxSurface,
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Modal,
  StickyButton,
  StickyInput,
  StickyInputVariant,
} from "@/app/atoms";
import { SessionCard } from "@/app/components/sessions/SessionCard";
import { SessionFilters } from "@/app/components/sessions/SessionFilters";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { routes } from "@/app/lib/routes";
import { errorMessage } from "@/app/providers/ToastProvider";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import { useSessions } from "@/app/services/queries";
import {
  clearAttention,
  trackAttention,
  useAttention,
} from "@/app/store/attentionStore";
import {
  setQuery,
  useFilterQuery,
  useVisibleSessions,
} from "@/app/store/sessionFiltersStore";
import type { ManagedSessionSummary } from "@/app/types/api";

// Columns are 360px at minimum and stretch to fill the row, so the design's
// 3-up layout falls out naturally at the 1520px reference width and wider
// viewports gain columns instead of empty space.
function CardGrid({
  children,
  single,
}: {
  children: React.ReactNode;
  /** One card per row, which is all a phone has width for. */
  single: boolean;
}) {
  return (
    <div
      className={cn(
        "grid gap-2",
        single
          ? "grid-cols-1"
          : "grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))]",
      )}
    >
      {children}
    </div>
  );
}

/** Wrapper so each card can subscribe to its own attention flag. */
function GridCard({
  entry,
  onOpen,
}: {
  entry: ManagedSessionSummary;
  onOpen: (id: string) => void;
}) {
  const actions = useSessionActions();
  const attention = useAttention(entry.summary.session_id);

  return (
    <SessionCard
      entry={entry}
      selected={false}
      attention={attention}
      onOpen={onOpen}
      onTogglePin={(e) => void actions.togglePin(e.summary)}
      onRename={(e) => actions.rename(e.summary)}
      onDelete={(e) => actions.remove(e.summary)}
      onStop={(e) => void actions.stopRun(e.summary)}
    />
  );
}

export default function SessionsListPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const actions = useSessionActions();
  const query = useFilterQuery();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { data, isLoading, error } = useSessions();
  const all = data ?? [];
  const sessions = useVisibleSessions(all);

  useEffect(() => {
    if (data) trackAttention(data, null);
  }, [data]);

  const openSession = (id: string) => {
    clearAttention(id);
    navigate(routes.session(id));
  };

  const pinned = sessions.filter((entry) => entry.summary.pinned);
  const unpinned = sessions.filter((entry) => !entry.summary.pinned);
  const countLabel = `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`;

  const renderCard = (entry: ManagedSessionSummary) => (
    <GridCard
      key={entry.summary.session_id}
      entry={entry}
      onOpen={openSession}
    />
  );

  const newButton = (
    <Button
      variant={ButtonVariant.Primary}
      size={ButtonSize.Medium}
      content={ButtonContent.IconLeft}
      onClick={actions.launch}
    >
      <Icon iconName={IconName.Add} size={16} /> New
    </Button>
  );

  // Pinned under the bar rather than scrolling with the cards, so search and
  // filters stay in reach. The 144px of head room below clears it.
  const searchBar = (
    <div className="fixed inset-x-0 top-16 z-10 flex items-start gap-3 px-2 py-4">
      <StickyInput
        className="flex-1 min-w-0"
        variant={StickyInputVariant.Search}
        placeholder="Search sessions…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onClear={() => setQuery("")}
        aria-label="Search sessions"
      />
      <StickyButton
        variant={ButtonVariant.Secondary}
        content={ButtonContent.Icon}
        aria-label="Filters"
        aria-expanded={filtersOpen}
        onClick={() => setFiltersOpen(true)}
      >
        <Icon iconName={IconName.Controls} />
      </StickyButton>
    </div>
  );

  // The phone puts the filters behind the full-screen dialog and dismisses it
  // as soon as one moves, so the results are visible without a second tap.
  const filtersDialog = (
    <Modal
      open={filtersOpen}
      onClose={() => setFiltersOpen(false)}
      title="Filters"
      bodyClassName="p-0"
    >
      <SessionFilters
        sessions={all}
        showSearch={false}
        mobile
        onChange={() => setFiltersOpen(false)}
      />
    </Modal>
  );

  const rail = (
    <BoxSurface
      title={countLabel}
      headerContent={
        <div className="flex items-center gap-2 shrink-0">{newButton}</div>
      }
      className="h-full"
      bodyClassName="overflow-auto"
    >
      <SessionFilters sessions={all} />
    </BoxSurface>
  );

  return (
    <div className="flex h-full min-h-0">
      {isMobile ? null : (
        <aside className="w-[360px] shrink-0 p-2 pt-16 min-h-0">{rail}</aside>
      )}
      {isMobile ? searchBar : null}
      {isMobile ? filtersDialog : null}

      <div
        className={cn(
          "flex-1 min-h-0 overflow-auto",
          isMobile ? "px-2" : "px-4",
        )}
      >
        <div
          className={cn(
            "flex flex-col gap-6 [&>*]:shrink-0",
            isMobile ? "pt-36 pb-8" : "pt-16 pb-2",
          )}
        >
          {error ? (
            <div className="label-small text-error-primary">
              {errorMessage(error)}
            </div>
          ) : null}

          {!isLoading && sessions.length === 0 ? (
            <div className="label-small text-basic-muted text-center py-16">
              No sessions match the current filters.
            </div>
          ) : null}

          {pinned.length > 0 ? (
            <CardGrid single={isMobile}>{pinned.map(renderCard)}</CardGrid>
          ) : null}
          {unpinned.length > 0 ? (
            <CardGrid single={isMobile}>{unpinned.map(renderCard)}</CardGrid>
          ) : null}
        </div>
      </div>
    </div>
  );
}
