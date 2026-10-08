# Revision-pinned native presentation

Import the actual native runtime and root from the private experimental artifact:

```tsx
import {
  createNativeRuntime,
  NativePresentationRoot,
} from "@arcee-ai/nac-client-all-121/presentation";
import "@arcee-ai/nac-client-all-121/presentation/styles.css";
```

Build NAC with `npm --prefix crates/nac-server/web run build`, then `npm pack
--ignore-scripts` at the repository root. Pin the exact source revision and npm
integrity. The package is private; this does not authorize publication.

The caller owns authentication, stream construction, the DOM mount, router and
asset hosting. Copy the paths in `presentation/assets.json` from the packed
artifact to static storage preserving their paths; set `assets.mathjaxFontUrl`
on `createNativeRuntime` to the public MathJax font directory. Formula fonts
are fetched there. The stylesheet is opt-in, scoped to `[data-nac-runtime]`, and
uses namespaced fonts, animations and Tailwind registrations. Browser support
must include nested CSS and `@scope`, or the consumer must compile them.

A product with BrowserRouter must mount the native MemoryRouter in a separate
caller-owned React root. Close the old runtime before replacement, logout,
revoked eligibility or host deletion, then unmount its React root. Bindings are
opaque state partitions and never authorization. Accepted mutations with lost
responses require authoritative readback without replay.

Qualified locked peers: React/ReactDOM 19.2.8, React Router 7.18.2, TanStack Query
5.101.4; and React/ReactDOM 19.2.6, React Router 7.15.0, TanStack Query 5.100.10.
Peers are optional for SDK-only imports. The declared major ranges do not
qualify every intermediate release. Local desktop/mobile tarball qualification
covers router, styles, assets, keyboard/overlay ownership and lifecycle; an
actual authenticated product gateway, identity/custody, machine-to-machine
admission and Dev2 readiness remain separate acceptance work.
