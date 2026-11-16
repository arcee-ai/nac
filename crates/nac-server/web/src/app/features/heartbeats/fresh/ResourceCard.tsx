import { Link } from "react-router-dom";
import { routes } from "@/app/lib/routes";
import type { FreshTaskLaunchReceipt, TaskLaunchRecord } from "@/app/types/api";
import { useFreshInitialInput } from "./queries";

const preparation = {
  pinned: "Commit pinned",
  preparing_workspace: "Preparing isolated checkout",
  preparing_runtime: "Checking agent readiness",
  ready: "Task ready",
  failed: "Preparation failed; owned files retained",
  cancelled: "Preparation cancelled; owned files retained",
};

export function ResourceCard({
  receipt,
  launch,
  present,
}: {
  receipt: FreshTaskLaunchReceipt;
  launch?: TaskLaunchRecord;
  present: boolean | undefined;
}) {
  const exists = launch?.session_present ?? present;
  const outcome = receipt.initial_outcome;
  const initial = useFreshInitialInput(
    receipt.session_id,
    receipt.first_input_id,
    exists,
    outcome != null,
  );
  return (
    <article
      id={`occurrence-${receipt.occurrence_id}`}
      data-occurrence={receipt.occurrence_id}
      tabIndex={-1}
      className="rounded-xl border border-muted p-4 flex flex-col gap-2 min-w-0"
    >
      <h3 className="header-sm">{receipt.request.title}</h3>
      <p role="status">
        {outcome
          ? `Initial occurrence settled: ${outcome.outcome ?? outcome.state}`
          : receipt.initial_run_id
            ? "Initial run admitted"
            : receipt.first_input_id != null
              ? "Task ready; initial input accepted"
              : launch
                ? preparation[launch.phase]
                : "Occurrence accepted; preparing task"}
      </p>
      {initial.data && (
        <p>
          Initial input {initial.data.status}
          {initial.data.delivered_at
            ? ` at ${new Date(initial.data.delivered_at).toLocaleString()}`
            : ""}
          .
        </p>
      )}
      {initial.error && (
        <p className="text-basic-muted">
          Live initial-input receipt is unavailable. Retained occurrence evidence remains below.
        </p>
      )}
      {receipt.shared_directory === true && (
        <p>Shared Local directory: tasks use the same files.</p>
      )}
      {launch && (
        <>
          <p className="break-all text-small">
            {launch.source.selected_ref} → {launch.source.commit}
          </p>
          <p className="break-all text-small">
            Workspace: {launch.workspace_path}
            {launch.source.subdirectory ? `/${launch.source.subdirectory}` : ""}
          </p>
          <p className="text-basic-muted text-small">
            Source edits excluded. Checkout retained after completion, cancellation, and task
            deletion.
          </p>
          {launch.error && (
            <p role="alert" className="break-words">
              {launch.error}
            </p>
          )}
        </>
      )}
      <p className="break-all text-small">Local · Source: {receipt.binding.cwd}</p>
      {!launch && receipt.binding.execution_cwd && (
        <p className="break-all text-small">Directory: {receipt.binding.execution_cwd}</p>
      )}
      <p className="text-small">Request: {receipt.request.request_id}</p>
      {receipt.initial_run_id && (
        <p className="break-all text-small">Initial run: {receipt.initial_run_id}</p>
      )}
      {outcome?.evidence && <p className="whitespace-pre-wrap">{outcome.evidence}</p>}
      {outcome && (
        <p className="text-small text-basic-muted">
          {outcome.tokens_used == null
            ? "Initial usage unknown"
            : `${outcome.tokens_used} initial-run tokens`}
          . Later human runs remain separate.
        </p>
      )}
      {receipt.stop_requested && <p>Stop remains bound to this occurrence.</p>}
      {receipt.first_input_id != null && exists === false && (
        <p>Task removed; its retained launch and workspace remain owned.</p>
      )}
      {receipt.first_input_id != null && exists === true && (
        <Link className="text-info-primary underline" to={routes.session(receipt.session_id)}>
          Open task
        </Link>
      )}
    </article>
  );
}
