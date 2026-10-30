import { useCallback, useLayoutEffect, useRef, useState } from "react";

import {
  useBrowsePath,
  useResolveBrowsePath,
  useSshBrowsePath,
  type BrowseKind,
  type BrowseSource,
} from "@/app/services/queries";
import type { SshTarget } from "@/app/types/api";

interface PathPickerOptions {
  open: boolean;
  kind: BrowseKind;
  initialPath: string;
  ssh: SshTarget | null;
  showHidden: boolean;
  onSelect: (path: string) => void;
}

/** A Select the server has not answered yet, and the path it is checking. */
interface PendingSelect {
  path: string;
  epoch: number;
}

/** A Select the server refused, kept beside the draft it was made from. */
export interface SelectFailure {
  path: string;
  error: Error;
}

interface BoundFailure extends SelectFailure {
  epoch: number;
}

/** Identifies the filesystem a path belongs to, so answers never cross hosts. */
function sourceIdentity(ssh: BrowseSource): string {
  return ssh
    ? JSON.stringify([ssh.ssh_host, ssh.ssh_port ?? null, ssh.ssh_identity_file ?? null])
    : "local";
}

/**
 * State for one open path picker: the listed directory, the editable draft
 * above it, and Select.
 *
 * When picking a directory, the draft the user can see is what Select applies.
 * It goes to the server through the same listing query Enter navigates with —
 * the server expands `~`, canonicalizes, and refuses what is missing, not a
 * directory, or unreadable — and only the path the server resolved is handed
 * to `onSelect`. Nothing is created, and no client-side path rule is applied.
 *
 * An answer is applied only to the Select that asked for it: editing the
 * draft, navigating elsewhere, switching source, closing or unmounting the
 * picker all supersede a pending check, and its late answer is dropped.
 * File pickers keep choosing a listed file, as before.
 */
export function usePathPicker({
  open,
  kind,
  initialPath,
  ssh,
  showHidden,
  onSelect,
}: PathPickerOptions) {
  const pickingFile = kind !== "directory";
  // A directory is picked from an empty path so the server starts at its root,
  // or the host at the login home.
  const [directory, setDirectory] = useState(initialPath.trim());
  const [draft, setDraftValue] = useState(initialPath.trim());
  const [file, setFile] = useState<string | null>(null);
  const [hidden, setHidden] = useState(showHidden);
  const [pending, setPending] = useState<PendingSelect | null>(null);
  const [failure, setFailure] = useState<BoundFailure | null>(null);
  // Bumped whenever the pending check stops being the one the user wants; a
  // response carrying an older generation is ignored. `inFlight` holds the
  // generation still waiting, so a second click cannot start a second check.
  const generation = useRef(0);
  const inFlight = useRef<number | null>(null);

  // Both hooks are called every render, as hooks must be; the one that is not
  // the source of this listing is disabled and never fetches.
  const local = useBrowsePath(directory || null, kind, hidden, !ssh);
  const remote = useSshBrowsePath(ssh, directory || null, hidden, Boolean(ssh));
  const listing = ssh ? remote : local;
  const resolve = useResolveBrowsePath();

  const supersede = useCallback(() => {
    generation.current += 1;
    inFlight.current = null;
    setPending(null);
  }, []);

  // Pending and failed Selects belong to the source and the opening they were
  // made in. A different source, closing the picker or unmounting it drops any
  // answer still on its way, in the same commit as the change, and anything
  // left over from before is simply not shown.
  const binding = `${open ? "open" : "closed"}:${sourceIdentity(ssh)}`;
  // Counts bindings rather than naming them, so switching away and back again
  // does not revive a Select made before the switch.
  const [bound, setBound] = useState({ binding, epoch: 0 });
  if (bound.binding !== binding) setBound({ binding, epoch: bound.epoch + 1 });
  const epoch = bound.binding === binding ? bound.epoch : bound.epoch + 1;
  useLayoutEffect(() => {
    const current = generation;
    const waiting = inFlight;
    return () => {
      current.current += 1;
      waiting.current = null;
    };
  }, [binding]);

  const goTo = (path: string) => {
    supersede();
    setFailure(null);
    setDirectory(path);
    setDraftValue(path);
    setFile(null);
  };

  const setDraft = (value: string) => {
    supersede();
    setFailure(null);
    setDraftValue(value);
  };

  // What Select would apply right now. A cleared draft falls back to the
  // listed directory rather than to nothing.
  const typed = draft.trim() || directory;
  const chosen = pickingFile ? file : typed || (listing.data?.path ?? "");

  const select = () => {
    if (pickingFile) {
      if (file) onSelect(file);
      return;
    }
    if (inFlight.current !== null) return;
    const path = typed;
    const ticket = ++generation.current;
    inFlight.current = ticket;
    setPending({ path, epoch });
    setFailure(null);
    resolve(ssh, path || null, kind, hidden).then(
      (resolved) => {
        if (ticket !== generation.current) return;
        // Settled for good: nothing later can apply this answer again.
        generation.current += 1;
        inFlight.current = null;
        setPending(null);
        onSelect(resolved.path);
      },
      (error: unknown) => {
        if (ticket !== generation.current) return;
        inFlight.current = null;
        setPending(null);
        setFailure({
          path,
          epoch,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      },
    );
  };

  return {
    /** Identifies this opening and source; answers made under another are stale. */
    binding,
    pickingFile,
    directory,
    draft,
    setDraft,
    goTo,
    file,
    chooseFile: setFile,
    hidden,
    toggleHidden: () => setHidden((on) => !on),
    listing,
    chosen,
    select,
    /** The path a Select is waiting on the server for, if any. */
    checking: pending?.epoch === epoch ? pending.path : null,
    failure: failure?.epoch === epoch ? failure : null,
  };
}
