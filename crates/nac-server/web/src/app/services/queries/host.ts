import { Atom } from "effect/reactivity";
import { Effect } from "effect";

import { idleAtom, nacAtoms, refreshPrefixed, remoteAtom, type Remote } from "@/app/effect/remote";
import { apiEffect } from "@/app/services/api";
import { refreshProviderAuthentication } from "@/app/services/queries/configuration";
import { atomIds } from "@/app/services/queries/keys";
import type {
  ManagedAuthProvider,
  SandboxActivity,
  SandboxAvailability,
  StoredCredentialList,
} from "@/app/types/api";

export const storeInfoAtom = remoteAtom(atomIds.store, () => apiEffect.getStore(), {
  staleMs: Number.POSITIVE_INFINITY,
  retry: false,
});

/**
 * Whether this host can run sandboxed sessions. Probing spawns podman
 * subprocesses, so it runs only while a caller asks for it — today that is
 * the launch form with sandbox mode selected.
 */
const sandboxAvailabilityRemote = remoteAtom(
  atomIds.sandboxAvailability,
  () => apiEffect.getSandboxAvailability(),
  { retry: false },
);

export function sandboxAvailabilityAtom(enabled: boolean): Remote<SandboxAvailability> {
  return enabled ? sandboxAvailabilityRemote : idleAtom();
}

/**
 * Sandbox setup in progress for one launch (image pull, container start),
 * polled while the launch request is in flight so a minutes-long first pull
 * shows movement instead of a frozen button. Keyed by the launch id sent
 * with the create request, so concurrent launches stay independent.
 */
const sandboxActivityFamily = Atom.family((key: string) =>
  remoteAtom(atomIds.sandboxActivity(key), () => apiEffect.getSandboxActivity(key), {
    staleMs: 0,
    pollMs: 1_000,
    retry: false,
  }),
);

export function sandboxActivityAtom(
  enabled: boolean,
  key: string | null,
): Remote<SandboxActivity | null> {
  if (!enabled || key === null) return idleAtom();
  return sandboxActivityFamily(key);
}

/**
 * Which API key names have a value stored in NAC home. Used to tell the user
 * whether a session can authenticate without the environment variable being
 * set; failures are non-fatal because the environment may well supply the key.
 */
const storedCredentialsRemote = remoteAtom(atomIds.credentials, () => apiEffect.listCredentials(), {
  retry: false,
});

export function storedCredentialsAtom(enabled = true): Remote<StoredCredentialList> {
  return enabled ? storedCredentialsRemote : idleAtom();
}

export const storeCredentialAtom = nacAtoms.fn((input: { name: string; value: string }, get) =>
  apiEffect
    .storeCredential(input.name, input.value)
    .pipe(
      Effect.tap(() => Effect.promise(() => refreshPrefixed(get.registry, atomIds.credentials))),
    ),
);

/**
 * Files a key away and reports the name it was given. Used where the key is the
 * thing the user supplies and the selector is an implementation detail.
 */
export const storeGeneratedCredentialAtom = nacAtoms.fn((value: string, get) =>
  apiEffect
    .storeGeneratedCredential(value)
    .pipe(
      Effect.tap(() => Effect.promise(() => refreshPrefixed(get.registry, atomIds.credentials))),
    ),
);

export const deleteCredentialAtom = nacAtoms.fn((name: string, get) =>
  apiEffect
    .deleteCredential(name)
    .pipe(
      Effect.tap(() => Effect.promise(() => refreshPrefixed(get.registry, atomIds.credentials))),
    ),
);

/**
 * Whether the providers that sign in through a browser are signed in. Reported
 * per provider rather than per configuration, because the credential is one
 * file in NAC home that every session using that backend shares.
 */
export const managedLogoutAtom = nacAtoms.fn((provider: ManagedAuthProvider, get) =>
  apiEffect.managedLogout(provider).pipe(
    Effect.tap(() =>
      // The model index was only readable through the login that just went
      // away, so what is cached from it is no longer true — including the copy a
      // resolved configuration carries.
      Effect.promise(() => refreshProviderAuthentication(get.registry)),
    ),
  ),
);
