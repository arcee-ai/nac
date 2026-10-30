import { useLayoutEffect, useRef, useState } from "react";

import { ApiError } from "@/app/services/api";
import { useCreateFolder, useResolveBrowsePath, type BrowseSource } from "@/app/services/queries";

interface NewFolderOptions {
  source: BrowseSource;
  /** The directory being listed, which is where the folder is made. */
  parent: string | null;
  /**
   * Changes whenever an answer stops belonging to what the person sees: a
   * different directory, source or opening of the picker.
   */
  binding: string;
  /** Called with the server's path once the folder certainly exists. */
  onCreated: (path: string) => void;
}

/**
 * Where the inline New folder form stands. `uncertain-*` states follow a
 * request whose answer was lost, so the folder may or may not exist; the form
 * looks before it offers the same name again and never replays on its own.
 */
export type NewFolderStatus =
  | { kind: "editing" }
  | { kind: "creating"; name: string }
  | { kind: "refused"; name: string; error: Error }
  | { kind: "checking"; name: string; cause: Error }
  | { kind: "uncertain-exists"; name: string; path: string; cause: Error }
  | { kind: "uncertain-absent"; name: string; cause: Error }
  | { kind: "uncertain-unknown"; name: string; cause: Error; check: Error };

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * A refusal the server answered for certain. Anything else — a dropped
 * connection, a timeout, an unreachable SSH host, an unconfirmed result —
 * leaves the outcome unknown.
 */
function isDefinite(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

function childPath(parent: string, name: string): string {
  return parent.endsWith("/") ? `${parent}${name}` : `${parent}/${name}`;
}

/**
 * State for the picker's inline New folder form: one explicit request per
 * Create, made in the listed directory and bound to it, so a late answer for a
 * directory, source or picker the person has left is dropped.
 */
export function useNewFolder({ source, parent, binding, onCreated }: NewFolderOptions) {
  const [open, setOpen] = useState(false);
  const [name, setNameValue] = useState("");
  const [status, setStatus] = useState<NewFolderStatus>({ kind: "editing" });
  const create = useCreateFolder();
  const resolve = useResolveBrowsePath();
  // Every request carries the generation it started in; an answer from an
  // older one is ignored. `busy` keeps a second Create from starting a second
  // request while the first is still out.
  const generation = useRef(0);
  const busy = useRef(false);

  const [bound, setBound] = useState(binding);
  if (bound !== binding) {
    setBound(binding);
    setOpen(false);
    setNameValue("");
    setStatus({ kind: "editing" });
  }
  useLayoutEffect(() => {
    const current = generation;
    const waiting = busy;
    return () => {
      current.current += 1;
      waiting.current = false;
    };
  }, [binding]);

  const reset = () => {
    generation.current += 1;
    busy.current = false;
    setStatus({ kind: "editing" });
  };

  const reconcile = (ticket: number, target: string, folder: string, cause: Error) => {
    setStatus({ kind: "checking", name: folder, cause });
    resolve(source, childPath(target, folder), "directory", false).then(
      (listing) => {
        if (ticket !== generation.current) return;
        busy.current = false;
        setStatus({
          kind: "uncertain-exists",
          name: folder,
          path: listing.path,
          cause,
        });
      },
      (error: unknown) => {
        if (ticket !== generation.current) return;
        busy.current = false;
        if (error instanceof ApiError && error.status === 404) {
          setStatus({ kind: "uncertain-absent", name: folder, cause });
        } else if (isDefinite(error)) {
          // Something is there, but it is not a folder that can be opened.
          setStatus({ kind: "refused", name: folder, error: asError(error) });
        } else {
          setStatus({
            kind: "uncertain-unknown",
            name: folder,
            cause,
            check: asError(error),
          });
        }
      },
    );
  };

  const submit = () => {
    if (busy.current || !parent) return;
    if (status.kind === "uncertain-unknown" && status.name === name) return;
    const folder = name;
    const target = parent;
    const ticket = ++generation.current;
    busy.current = true;
    setStatus({ kind: "creating", name: folder });
    create(source, target, folder).then(
      (created) => {
        if (ticket !== generation.current) return;
        generation.current += 1;
        busy.current = false;
        setOpen(false);
        setNameValue("");
        setStatus({ kind: "editing" });
        onCreated(created.path);
      },
      (error: unknown) => {
        if (ticket !== generation.current) return;
        if (isDefinite(error)) {
          busy.current = false;
          setStatus({ kind: "refused", name: folder, error: asError(error) });
        } else {
          reconcile(ticket, target, folder, asError(error));
        }
      },
    );
  };

  const checkAgain = () => {
    if (status.kind !== "uncertain-unknown" || busy.current || !parent) return;
    const ticket = ++generation.current;
    busy.current = true;
    reconcile(ticket, parent, status.name, status.cause);
  };

  return {
    open,
    start: () => {
      reset();
      setNameValue("");
      setOpen(true);
    },
    cancel: () => {
      reset();
      setOpen(false);
      setNameValue("");
    },
    name,
    // The last outcome stays on screen while the name is edited; it is
    // replaced by the next Create.
    setName: setNameValue,
    status,
    pending: status.kind === "creating" || status.kind === "checking",
    /** Create is withheld only while the same name's outcome is unknown. */
    blocked: status.kind === "uncertain-unknown" && status.name === name,
    submit,
    checkAgain,
  };
}
