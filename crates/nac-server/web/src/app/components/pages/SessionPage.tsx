import { useEffect } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { Badge, BadgeColor, BoxSurface, Loader } from "@/app/atoms";
import { useRunStateSync, useSessionStream } from "@/app/hooks/useSessionStream";
import { formatDurationShort, metricsFromSnapshot, shortId } from "@/app/lib/format";
import {
  DEFAULT_INSPECTOR_TAB,
  INSPECTOR_TABS,
  isInspectorTab,
  routes,
} from "@/app/lib/routes";
import { useSessionSnapshot } from "@/app/services/queries";
import { clearAttention } from "@/app/store/attentionStore";
import {
  useActivity,
  useLiveEvents,
  useRunning,
  useStreamStatus,
} from "@/app/store/runtimeStore";
import type { StreamStatus } from "@/app/services/eventStream";

const STREAM_LABEL: Record<StreamStatus, { text: string; color: BadgeColor }> = {
  live: { text: "Live", color: BadgeColor.Green },
  connecting: { text: "Connecting…", color: BadgeColor.Yellow },
  reconnecting: { text: "Reconnecting…", color: BadgeColor.Yellow },
  error: { text: "Stream unavailable", color: BadgeColor.Red },
  idle: { text: "Idle", color: BadgeColor.Neutral },
};

/**
 * Placeholder inspector. The transcript, events, threads, worksets and
 * workspace panes land with the inspector stage; for now this proves the
 * stream, the snapshot query and the runtime store are wired together.
 */
export default function SessionPage() {
  const { sessionId, tab } = useParams<{ sessionId: string; tab?: string }>();
  const id = sessionId ?? null;

  const { data: snapshot, isLoading, error } = useSessionSnapshot(id);
  useSessionStream(id);
  useRunStateSync(snapshot?.active_run);

  const streamStatus = useStreamStatus();
  const running = useRunning();
  const activity = useActivity();
  const events = useLiveEvents();

  useEffect(() => {
    if (id) clearAttention(id);
  }, [id]);

  if (!id) return <Navigate to={routes.list()} replace />;
  if (tab !== undefined && !isInspectorTab(tab)) {
    return <Navigate to={routes.session(id, DEFAULT_INSPECTOR_TAB)} replace />;
  }

  const stream = STREAM_LABEL[streamStatus];
  const metrics = metricsFromSnapshot(snapshot, null);

  return (
    <div className="p-6 flex flex-col gap-4 max-w-[900px]">
      <div className="flex items-center gap-3">
        <Link to={routes.list()} className="text-basic-muted label-small hover:underline">
          ← Sessions
        </Link>
        <span className="code code-small text-basic-muted">{shortId(id)}</span>
        <Badge text={stream.text} color={stream.color} />
        {running && <Badge text="Running" color={BadgeColor.Green} />}
      </div>

      <nav className="flex items-center gap-1">
        {INSPECTOR_TABS.map((name) => (
          <Link
            key={name}
            to={routes.session(id, name)}
            className={
              name === (tab ?? DEFAULT_INSPECTOR_TAB)
                ? "px-3 py-1.5 rounded-md bg-elevation-level-2 text-basic-primary label-small"
                : "px-3 py-1.5 rounded-md text-basic-muted label-small hover:text-basic-primary"
            }
          >
            {name}
          </Link>
        ))}
      </nav>

      {isLoading && (
        <div className="flex items-center gap-3 text-basic-muted">
          <Loader />
          Loading snapshot…
        </div>
      )}

      {error && (
        <div className="text-error-primary paragraph-medium">
          {error instanceof Error ? error.message : "Failed to load session"}
        </div>
      )}

      {snapshot && (
        <>
          <BoxSurface title="Metrics">
            <dl className="p-4 grid grid-cols-3 gap-4">
              <Metric label="Model" value={metrics.model} />
              <Metric label="Backend" value={metrics.backend} />
              <Metric label="Messages" value={String(metrics.messages)} />
              <Metric label="Run" value={metrics.run} />
              <Metric label="Tokens" value={metrics.tokens} />
              <Metric
                label="Last response"
                value={formatDurationShort(metrics.lastResponseMs)}
              />
            </dl>
          </BoxSurface>

          <BoxSurface title={`Live events (${events.length})`}>
            <div className="p-4 flex flex-col gap-1 max-h-[320px] overflow-y-auto [&>*]:shrink-0">
              {activity && (
                <span className="code code-small text-info-primary">{activity}</span>
              )}
              {events.map((event, index) => (
                <span
                  key={`${event.seq ?? "local"}-${index}`}
                  className={
                    event.isError
                      ? "code code-small text-error-primary"
                      : "code code-small text-basic-muted"
                  }
                >
                  {event.text}
                </span>
              ))}
              {events.length === 0 && (
                <span className="code code-small text-basic-muted">
                  Waiting for events…
                </span>
              )}
            </div>
          </BoxSurface>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-micro text-basic-muted">{label}</dt>
      <dd className="label-small text-basic-primary truncate">{value}</dd>
    </div>
  );
}
