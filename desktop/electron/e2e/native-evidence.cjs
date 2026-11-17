"use strict";

// Test-controller evidence only. An unreadable process which is still present
// is unknown, not dead. A different positively sampled birth proves the old
// incarnation ended without granting authority over the replacement.
function identitiesSettled(known, samples, census) {
  const present = new Set(census);
  const observed = new Map(samples.map((value) => [value.pid, value]));
  return known.every((before) => {
    const current = observed.get(before.pid);
    return current?.valid
      ? current.birth_sec !== before.birth_sec || current.birth_usec !== before.birth_usec
      : !present.has(before.pid);
  });
}

async function settleNativeOwner({ identity, current, capture, requestQuit, waitForSettlement }) {
  const live = current();
  let requested = false,
    controlUnavailable = false;
  if (
    live?.valid &&
    live.birth_sec === identity.birth_sec &&
    live.birth_usec === identity.birth_usec
  ) {
    capture();
    requested = true;
    try {
      await requestQuit();
    } catch {
      controlUnavailable = true;
    }
  }
  // Required even if the app disappeared or its first counter was unavailable.
  // Only the independent census may conclude cleanup; never replay Quit.
  await waitForSettlement();
  return { requested, controlUnavailable, independentlySettled: true };
}

module.exports = { identitiesSettled, settleNativeOwner };
