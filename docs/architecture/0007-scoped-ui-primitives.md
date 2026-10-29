# Scoped UI primitives and presentation overlay layers

## Decision

Design-system atoms under `crates/nac-server/web/src/app/atoms/` keep their
public props, refs, events and form behavior, and are built on scoped
primitives in `src/app/ui/`. The primitives are adapted from shadcn/ui registry
source and run on Radix through the `radix-ui` package. Product components keep
importing atoms; only atoms, providers and other primitives import `ui/`, and
ESLint's `no-restricted-imports` rejects any other import of it.

Each presentation instance owns one overlay layer stack (`ui/layer-stack.ts`),
created by `PresentationBoundary`. It is the single owner of Escape,
outside-press dismissal, background inertness and focus return for every
primitive. Radix runs non-modal: it portals into the instance's overlay root,
positions and wires ARIA; the instance's dialog surface owns its Tab boundaries.
Radix's own Escape,
outside-interaction and close auto-focus handling is cancelled. Radix's modal
mode (`react-remove-scroll` and `aria-hidden`'s `hideOthers`) acts on the whole
document, so it would reach into the host page and into any sibling instance.
The build resolves both packages to `ui/radix-modal-stub.ts`, which throws if
it is ever reached.

## Pins and licenses

| Source | Pin | License | Notice |
| --- | --- | --- | --- |
| shadcn/ui `alert-dialog`, `button`, `dialog`, `dropdown-menu`, `input`, `label`, `popover`, `sheet`, `tooltip` | `shadcn-ui/ui` commit `96da9cc7f1aa10580a3741664e2a77c721206c00`, `apps/v4/registry/new-york-v4/ui/` | MIT, © 2023 shadcn | `shadcn-ui.txt` |
| Radix primitives | `radix-ui` `1.8.1`, exact; every `@radix-ui/*` package resolves to a single version in `package-lock.json` | MIT, © 2022 WorkOS | `radix-ui.txt` |
| Floating UI, Radix's positioning | transitive, locked in `package-lock.json` | MIT, © 2021-present Floating UI contributors | `floating-ui.txt` |

Notices live in `web/public/licenses/` and ship in `assets/dist/licenses/` and
in the presentation package's `dist/licenses/`. The build strips legal comments,
so every newly bundled dependency adds its notice there.

The primitives were adapted by hand from `apps/v4/registry/new-york-v4/ui/` at
the pinned commit, which releases CLI `shadcn@4.23.0`; the CLI was not run.
`components.json` records the registry style and the aliases, and points at
`src/app/ui/` and `src/app/ui/tokens.css` instead of global CSS or a Tailwind
configuration. Do not run `shadcn add` on this tree: it reads the hosted
registry (`https://ui.shadcn.com/r` unless `REGISTRY_URL` overrides it), not
the pinned commit, and the registry sources import lucide-react and
class-variance-authority, which NAC does not install. A new primitive starts
from the same path at the pinned commit, or at a newly pinned one, and is
reviewed like any imported code. Builds and CI never fetch from the registry.

## Adaptation rules

- Primitives export parts, not assembled shells. `DialogContent` and
  `SheetContent` render the surface alone; atoms compose portal, scrim and
  surface, and keep mobile panel geometry, delayed unmount and the shift of a
  covered modal.
- `ui/button` keeps NAC's `btn-*` classes behind `buttonVariants`, without
  class-variance-authority. Icons come from the Icon atom rather than
  lucide-react, and motion from NAC's `fade` rather than tw-animate-css.
  `fade` is unlayered CSS, so only `motion-reduce:!animate-none` switches it
  off for reduced motion; the unmodified utility loses to it.
- `ui/alert-dialog` is built on `ui/dialog` because Radix's AlertDialog forces
  modal mode. It keeps the `alertdialog` role, a described body and a scrim
  that dismisses only when asked to. The Modal atom's `alert` prop renders it,
  and product code marks the body text with `ModalDescription`.
- Popover content drops Radix's default `dialog` role unless its owner sets
  one. Atoms that focus a field when they open render the content
  conditionally with `forceMount`, so the panel exists in the commit that
  opens it.
- `ui/tooltip` carries its own provider and registers a `hint` layer. A tip
  that keyboard focus holds stays open when something around its trigger
  scrolls, which Radix would close it for: moving the focus onto a control can
  scroll its container, as a session row's actions do in the sidebar. The
  Tooltip atom shows no arrow and ignores focus without `:focus-visible`, such
  as focus a closing dialog hands back after a click.
- `ui/tokens.css` aliases shadcn's color names onto NAC tokens with
  `@theme inline`. Names NAC already owns (`primary`, `secondary`, `muted`,
  `card`, `input`) are not aliased; primitives use NAC's semantic classes.
- `ui/dropdown-menu` is available without a production consumer.

## Layer stack

| Kind | Used by | Behavior |
| --- | --- | --- |
| `modal` | Modal atom, alert dialogs | Turns global shortcuts off; a phone panel slides aside for a modal above it |
| `sheet` | Bottom sheets | Covers the view with its own scrim; leaves shortcuts and panels alone |
| `panel` | Popover and menu panels | Dismissed by a press outside it |
| `hint` | Tooltips | Takes Escape first; never intercepts a press |

- Escape goes to the topmost layer: bubble phase, ignored during IME
  composition, and only when the event target belongs to the instance's
  keyboard owner. A layer without an Escape handler swallows it, so nothing
  below it closes either. A field that stops propagation keeps the layers open.
- A press outside the topmost panel closes it, unless it lands on the panel's
  anchor or started inside the layer's React tree, portals included. Modals and
  sheets decide through their scrim, which closes only for a click that
  started on it while its layer was topmost.
- The topmost layer that blocks its background sets `inert` on the instance's
  content root, never on the document. The scrim stops wheel and touch
  scrolling.
- Focus returns to the element that was focused when the layer opened, unless
  focus has already moved elsewhere or the panel was dismissed by a press
  outside it. A layer opened while another closes, such as a menu row opening
  a dialog, inherits that pending return target.

## Host footprint

Embedding still observes these document-level Radix behaviors:

- focus guard spans at the edges of `document.body` while a dialog or popover
  is open;
- `preventDefault` on an Escape keydown that reaches an open Radix layer;
- a document `tooltip.open` event that closes tooltips in other Radix trees,
  including another instance's;
- a module-global focus scope stack, so opening a dialog in one instance pauses
  Radix's scope in another. Dialog and sheet surfaces enforce their own visible
  first/last Tab boundaries against the instance's top layer, preserving their
  keyboard loop even when Radix's scope is paused.

A press outside a panel dismisses it even when it lands in another instance,
as before the migration.

## Budget and verification

`web/scripts/startup-size.mjs` measures the complete initial-load graph of the
app and of the presentation package in gzip bytes: the entry module, statically
imported chunks and linked stylesheets. Lazy `import()` chunks are excluded and
stay lazy.

Budgets are fixed against one baseline, `dev` at
`cd7d3730bd47cc3c7b9de5204fd08496b19b155d`, not against the previous slice. The
pilot may add at most 30 KiB of startup JavaScript and 10 KiB of CSS to each
graph, and the complete migration at most 50 KiB and 15 KiB.

| Graph | Baseline JS | Baseline CSS | Pilot adds | Left for later slices |
| --- | --- | --- | --- | --- |
| App | 470,380 B | 23,184 B | 22.9 KiB JS, 0.2 KiB CSS | 27.1 KiB JS, 14.8 KiB CSS |
| Presentation | 435,096 B | 1,180,676 B | 27.0 KiB JS, 0.3 KiB CSS | 23.0 KiB JS, 14.7 KiB CSS |

These measurements use Node 26.12.0, gzip level 9, and the committed baseline
bundles on the same host as the repaired pilot build. Gzip byte counts can vary
with the runtime's compression implementation; compare both revisions together.
Keeping keyboard hints open through a scroll, added after that measurement,
adds 0.1 KiB of startup JavaScript to each graph (Node 24.16.0, both revisions
measured together).

Every later slice measures against this baseline. Exceeding a budget calls for
optimization or an explicit scope review; it is never waived silently.

Behavior coverage lives next to its owners: `ui/layer-stack.test.ts` (Escape
order, outside presses, inertness, focus return), `ui/overlays.test.tsx` (nested
legacy and migrated layers, the dropdown menu, tooltips, standalone and
embedded keyboard ownership, two embedded instances), `atoms/modal/index.test.tsx`
(the phone panel), `atoms/input/index.test.tsx`, tooltip accessible-description
coverage in `atoms/tooltip/index.test.tsx`, and the rename and delete journey in
`providers/SessionActionsProvider.test.tsx`. Production-browser qualification in
`e2e/overlay-isolation.e2e.ts` exercises two runtimes' Tab boundaries, nested
panels, Escape, focus return, inertness, portals, tooltip descriptions and
shortcuts. Browser emulation does not replace real screen-reader, physical
device or OS input-method acceptance.

## Extension

- Migrating another overlay atom means registering it with `useLayer` and
  cancelling Radix's dismissal with `keepOpen`, not adding listeners of its
  own.
- A primitive that cannot run without Radix's modal helpers needs its own
  decision before adoption. Radix Select, for example, always locks scrolling
  and hides its siblings.
- Upgrading `radix-ui` or re-syncing shadcn source is a reviewed dependency
  change: move the exact pin, rerun the size measurement and these tests, and
  update the notices.
