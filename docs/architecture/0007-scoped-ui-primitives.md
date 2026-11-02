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
  a dialog, inherits that pending return target. The pending return also keeps
  the closing content: a still-connected row inside an exiting phone sheet is
  not a usable opener for the replacement dialog. A deliberate opener outside
  that content is preserved. Only the latest pending restore may run; a new
  layer cancels it before taking focus.

The Popover atom's opt-in `focusScope`, originally ported from `dev` with
#449 for terminal actions, owns initial focus and Tab navigation in the panel
and phone sheet. Escape and focus return now belong to the same layer stack as
other overlays: a hint above the menu takes Escape first, and
`closeOnEscape={false}` holds the panel or sheet without dismissing its parent.
The earlier independent Escape/focus-return exception is retired.

Rename's stable modal controller retains each session's pending operation and
submitted title/pin beyond the temporary form's exit lifetime. Reopening resumes
that operation without a second write. Completion records only that session's
accepted revision and closes only its currently open rename; it cannot dismiss a
newer session's form or another kind of modal. A failure releases only its own
guard so the visible draft can be retried. Query mutation and invalidation remain
with the existing service/query owner.

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

Budgets count what the migration itself adds. Each slice measures against the
`dev` revision it builds on, so changes that land on `dev` outside the
migration neither use up nor free budget, and the amounts of earlier slices
carry forward. The pilot may add at most 30 KiB of startup JavaScript and
10 KiB of CSS to each graph, and the complete migration at most 50 KiB and
15 KiB. The pilot builds on `dev` at `2c61af1a7d5af86f9b094f4140838ee7676c7b9f`.

| Graph | Baseline JS | Baseline CSS | Pilot adds | Left for later slices |
| --- | --- | --- | --- | --- |
| App | 421,418 B | 23,493 B | 23.0 KiB JS, 0.2 KiB CSS | 27.0 KiB JS, 14.8 KiB CSS |
| Presentation | 386,795 B | 1,174,581 B | 27.3 KiB JS, 0.3 KiB CSS | 22.7 KiB JS, 14.7 KiB CSS |

These measurements use Node 24.16.0, gzip level 9, and the committed bundles of
both revisions on the same host. Gzip byte counts can vary with the runtime's
compression implementation; compare both revisions together. The table includes
keyboard hints surviving container scrolling and accepted rename revisions
surviving the exit form's lifetime.

The Escape/pending-operation repair atop stacked head `4644af1b` was measured
with Node 26.12.0 against the committed immediate predecessor, #453 at
`a22a153a923cf2bedc3cac9d7ecf0932df1fd855`, using the same script and gzip
implementation for both graphs. The repaired pilot adds 24,189 B startup JS /
228 B CSS to the app and 28,077 B startup JS / 265 B CSS to the presentation
package, within the pilot budgets. The repair itself adds 188 B and 175 B JS,
respectively, over `4644af1b`, with no CSS growth. The table above retains the
earlier `dev` comparison; unrelated predecessor changes are not migration budget.
The nested phone Review handoff accounts for 28 B and 24 B of that JS growth,
respectively, over repair head `87de29f3`, with no CSS change.

The pilot was first measured against `dev` at
`cd7d3730bd47cc3c7b9de5204fd08496b19b155d`. Merging `dev` after the side-panel
stack moved its baseline to `2c61af1a7`. The stack's own changes removed about
49 KiB of startup JavaScript from the app graph and 47 KiB from the
presentation graph; that reduction is not budget for later slices. Measured the
same way against `cd7d3730`, the pilot adds the same amounts.

Exceeding a budget calls for optimization or an explicit scope review; it is
never waived silently.

### Conversation canary (ALL-525)

The conversation keeps the existing activity-group link into Insights. Reasoning
detail uses one disclosure per chronological reasoning segment, without copying
Trace or introducing an AI SDK. `/design` exercises the production component and
records its 14px/22px secondary prose, 12px paragraph rhythm, 16px inset, 1px rule,
unfilled surface and 44px controls. Answer typography remains 14px/24px primary.
Live reasoning opens initially; completed mounts start collapsed. Explicit reader
choices survive chunks/refetch, and settlement preserves focused or selected
content. No duration or success state is inferred from missing transcript data.

With Node 26.12.0 and this same startup graph script/gzip implementation, ALL-525
adds 732 B JS / 159 B CSS to the app and 880 B JS / 288 B CSS to presentation
over preserved pilot `75b2c028`. Adding those deltas to the pilot's measured
24,189/228 B and 28,077/265 B retains the cumulative +50/+15 KiB ceilings.
These are build-size results, not a human visual-acceptance decision.

Behavior coverage lives next to its owners: `ui/layer-stack.test.ts` (Escape
order, outside presses, inertness, focus return), `ui/overlays.test.tsx` (nested
legacy and migrated layers, the dropdown menu, tooltips, standalone and
embedded keyboard ownership, two embedded instances), `atoms/modal/index.test.tsx`
(the phone panel), `atoms/popover/FocusScope.test.tsx` (the focus-scoped
terminal menu on desktop and phone), `atoms/input/index.test.tsx`, tooltip
accessible-description coverage in `atoms/tooltip/index.test.tsx`, and the
rename and delete journey in `providers/SessionActionsProvider.test.tsx`.
Production-browser qualification in
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
