import { contextShare, resolveCatalogModel } from "@/app/lib/catalog";
import { formatCostMicros, formatTokensCompact, runMetrics, tokenUsage } from "@/app/lib/format";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useModelCatalog } from "@/app/services/queries";
import type { ManagedSessionSummary, SessionSnapshotResponse } from "@/app/types/api";

/**
 * The usage readings the session menu lists: context, tokens, cost and the
 * run clock, from the live run while one is going and the persisted spend
 * otherwise. The same derivation the session header used to draw.
 */
export function useUsageReadings(
  sessionId: string,
  snapshot: SessionSnapshotResponse | null,
  entry: ManagedSessionSummary | null,
) {
  const {
    useSessionSpend,
    useRunning,
    useRunUsage,
    useRunStartedAt,
    useLastElapsedMs,
    useCancelArmed,
  } = useNativeRuntime().stores.runtimeStore;
  const running = useRunning(sessionId);
  const stopping = useCancelArmed(sessionId);
  const runUsage = useRunUsage();
  const sessionSpend = useSessionSpend();
  const runStartedAt = useRunStartedAt();
  const lastElapsedMs = useLastElapsedMs();
  const catalog = useModelCatalog();

  const metrics = runMetrics(snapshot, entry, running || stopping ? runUsage : null, sessionSpend);
  const persistedUsage = tokenUsage(snapshot);
  const contextTokens = metrics.usage?.total_tokens || persistedUsage?.total_tokens || null;

  return {
    context: formatTokensCompact(contextTokens),
    contextShare: contextShare(
      contextTokens,
      resolveCatalogModel(catalog.data, snapshot?.metadata?.backend, metrics.model),
    ),
    input: formatTokensCompact(metrics.usage?.input_tokens),
    output: formatTokensCompact(metrics.usage?.output_tokens),
    cacheRead: metrics.usage?.cache_read_tokens
      ? formatTokensCompact(metrics.usage.cache_read_tokens)
      : null,
    cost: formatCostMicros(metrics.usage?.cost?.total),
    running,
    startedAt: runStartedAt,
    lastElapsedMs: lastElapsedMs ?? metrics.lastResponseMs,
  };
}
