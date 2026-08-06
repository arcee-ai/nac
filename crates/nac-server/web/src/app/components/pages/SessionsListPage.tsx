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
} from "@/app/atoms";
import { SessionCard } from "@/app/components/sessions/SessionCard";
import { SessionFilters } from "@/app/components/sessions/SessionFilters";
import { useIsDesktop } from "@/app/hooks/useMediaQuery";
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
import { useVisibleSessions } from "@/app/store/sessionFiltersStore";
import type { ManagedSessionSummary } from "@/app/types/api";

// Columns are 360px at minimum and stretch to fill the row, so the design's
// 3-up layout falls out naturally at the 1520px reference width and wider
// viewports gain columns instead of empty space.
function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))]">
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
  const isDesktop = useIsDesktop();
  const actions = useSessionActions();
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
      {isDesktop ? (
        <aside className="w-[360px] shrink-0 p-2 pt-16 min-h-0">{rail}</aside>
      ) : null}

      <div className="flex-1 min-h-0 overflow-auto px-4">
        <div className="pb-2 pt-16 flex flex-col gap-6 [&>*]:shrink-0">
          {!isDesktop ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="header-md text-basic-primary flex-1 min-w-0">
                  {countLabel}
                </div>
                <Button
                  variant={ButtonVariant.Secondary}
                  size={ButtonSize.Medium}
                  content={ButtonContent.IconRight}
                  onClick={() => setFiltersOpen((v) => !v)}
                >
                  Filters
                  <Icon
                    iconName={IconName.Down}
                    className={cn(
                      "transition-transform",
                      filtersOpen && "rotate-180",
                    )}
                  />
                </Button>
                {newButton}
              </div>
              {filtersOpen ? (
                <BoxSurface>
                  <SessionFilters sessions={all} />
                </BoxSurface>
              ) : null}
            </div>
          ) : null}

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
            <CardGrid>{pinned.map(renderCard)}</CardGrid>
          ) : null}
          {unpinned.length > 0 ? (
            <CardGrid>{unpinned.map(renderCard)}</CardGrid>
          ) : null}
        </div>
      </div>
    </div>
  );
}
