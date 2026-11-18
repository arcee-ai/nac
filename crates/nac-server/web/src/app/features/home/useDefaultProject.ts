import { useEffect, useRef, useState } from "react";

import { useManagedHostStatus } from "@/app/features/managed/queries";
import { standalonePreferenceStorage } from "@/app/lib/store";
import { useCreateProject, useProjects, useStoreInfo } from "@/app/services/queries";

const SEEDED_KEY = "nac.default-project-seeded";

function seeded() {
  try {
    return standalonePreferenceStorage.getItem(SEEDED_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeeded() {
  try {
    standalonePreferenceStorage.setItem(SEEDED_KEY, "1");
  } catch {
    // Without storage the default may be offered again; the server still
    // refuses a second project for the same folder.
  }
}

/**
 * First run: give a fresh install one project for the server's launch folder,
 * so a new user can start a chat without creating a project first. Runs once;
 * an install that already has projects is marked done, so deleting every
 * project later does not bring the default back.
 *
 * TODO(backend): seed this at server first start from the folder `nac-web`
 * confirms (`-C`/the startup prompt), and record that it ran in the store
 * instead of this browser's local storage. Managed hosts keep their
 * repository flow and are never seeded.
 *
 * Returns true while the default is being decided or created, so Home can
 * show its loading state instead of flashing the empty state.
 */
export function useDefaultProject(): boolean {
  const projects = useProjects();
  const storeInfo = useStoreInfo();
  const managed = useManagedHostStatus();
  const createProject = useCreateProject();
  const started = useRef(false);
  const [failed, setFailed] = useState(false);

  const projectCount = projects.data?.projects.length;
  const rootCwd = storeInfo.data?.root_cwd ?? null;
  const managedSettled = managed.isSuccess || managed.isError;
  const isManaged = managed.data?.managed === true;

  const candidate = !failed && !isManaged && projects.isSuccess && projectCount === 0 && !seeded();
  const ready = candidate && managedSettled && rootCwd !== null;

  useEffect(() => {
    if (projects.isSuccess && projectCount !== undefined && projectCount > 0) markSeeded();
  }, [projects.isSuccess, projectCount]);

  const create = createProject.mutateAsync;
  useEffect(() => {
    if (!ready || started.current || rootCwd === null) return;
    started.current = true;
    create({
      cwd: rootCwd,
      name: null,
      ssh_host: null,
      ssh_port: null,
      ssh_identity_file: null,
      default_model_config_id: null,
    })
      .then(markSeeded)
      .catch(() => setFailed(true));
  }, [ready, rootCwd, create]);

  const waitingForFacts = candidate && (!managedSettled || storeInfo.isPending);
  const awaitingRefetch = createProject.isSuccess && projectCount === 0;
  return waitingForFacts || ready || createProject.isPending || awaitingRefetch;
}
