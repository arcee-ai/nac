# NAC Clippy policy cleanup

Last updated: 2026-08-27

## Objective and discipline

Adopt a curated, warning-free workspace Clippy policy that improves correctness,
idiomatic Rust, ownership clarity, determinism, and maintenance without enabling
noisy lint groups. Add exactly one lint at a time, run Clippy autofix first,
resolve remaining diagnostics deliberately, run proportional checks/tests, and
commit that green boundary before adding the next lint.

Protected pre-existing state must remain unstaged and unchanged:
`.gitignore`, `progress.md`, `.agents/skills/goal-prompt/`, `demo_review.md`, and
`manual_todo.md`.

## Baseline and reference evidence

- NAC starts at `1c8020efc149662989e7c655edd7ea6be0d5ce6a` with `make lint`
  green under Clippy 0.1.98 / Rust 1.98.0.
- `/Users/allison/git/codex` is clean `main` at
  `c941572917b9295c7318b28aab27709202a645c7`. Its policy uses individually
  selected deny lints, including panic avoidance, async-lock checks, redundant
  ownership/closure cleanup, and modern format arguments. It does not enable
  blanket pedantic or nursery groups.
- `/Users/allison/git/agentic_auxilary` is clean `main` at
  `81db6151a7a0d08907bde51e24aafc05fd8dd676`. It enables pedantic and nursery
  with explicit exclusions, plus restriction lints for unsafe documentation,
  reference-counted clone clarity, panic avoidance, and justified attributes.
- NAC already treats ordinary Clippy warnings as errors in `make lint`, so
  explicitly listing default `clippy::all` members is redundant. Workspace
  crates all inherit the root lint table.

## Chosen lint sequence

Each item gets its own autofix/fix/check/test/commit boundary:

1. `uninlined_format_args` — modern, shorter format strings; fully mechanical.
2. `redundant_closure_for_method_calls` — clearer method references.
3. `clone_on_ref_ptr` — make `Arc`/`Rc` ownership increments explicit.
4. `redundant_clone` — remove unnecessary ownership and allocation.
5. `semicolon_if_nothing_returned` — consistent statement intent.
6. `match_same_arms` — eliminate duplicated branching behavior.
7. `needless_collect` — avoid unnecessary intermediate allocation.
8. `unused_async` — keep async APIs honest and futures smaller.
9. `significant_drop_in_scrutinee` — make guard/drop timing explicit.
10. `trivially_copy_pass_by_ref` — clarify the one small private API found.
11. `missing_assert_message` — make production invariant failures actionable.
12. `undocumented_unsafe_blocks` — require local safety reasoning.
13. `iter_over_hash_type` — prevent accidental nondeterministic iteration.
14. `unwrap_used` — remove undocumented panic paths in production code.
15. `expect_used` — replace or narrowly justify remaining panic invariants.
16. `allow_attributes_without_reason` — require rationale for suppressions.
17. `future_not_send` — retain a zero-backlog guard for spawned agent futures.

The order pays down mechanical churn before safety/manual work and adds the
zero-backlog async guard last.

## Rejected policies

- Whole `pedantic`, `nursery`, and `restriction` groups: compiler-version churn
  and preference-heavy diagnostics would dilute the hard gate.
- `wildcard_imports`: 104 findings are predominantly intentional sibling-module
  seams; Clippy suggests enormous brittle import lists.
- `indexing_slicing` and `string_slice`: 267 and 62 findings respectively,
  including validated protocol/text boundaries; adopt targeted APIs/tests
  rather than blanket suppression noise.
- `large_futures`: four findings, but its size threshold is compiler-sensitive
  and blanket boxing would add allocations. Treat measured hot paths directly.
- `manual_let_else`: style-dependent rewrites are not uniformly clearer.
- `create_dir`, `exit`, `panic`, and `map_err_ignore`: NAC deliberately uses
  fail-on-existence locks, outermost CLI exits, explicit invariant failures,
  and redacting error maps. Global policy would obscure those decisions.
- `self_named_module_files`: conflicts with established ownership-oriented
  module layout. Default `clippy::all` lints already enforced by `make lint`
  are not duplicated in the manifest.

## Progress

- `uninlined_format_args`: complete. Workspace autofix rewrote all 177
  diagnostics; no manual exceptions or residual diagnostics were required.
- `redundant_closure_for_method_calls`: complete. Clippy applied 105 safe
  rewrites. One suggestion incorrectly named the private `model::types` module;
  the equivalent method reference uses the public `crate::model::TokenUsage`
  re-export instead.
- `clone_on_ref_ptr`: complete. All 27 reference-count increments now use
  explicit `Arc::clone`; the type-erased native-tool registry uses
  `Arc::<T>::clone` so the result can retain its existing trait-object coercion.

## Verification and next action

The `uninlined_format_args` slice passes `make format-check`, `make lint`,
`git diff --check`, and the full Rust workspace suite (`make test-rust`):
1,156 core tests, 148 server library tests, 23 server binary tests, and all
credential-store, managed, process, catalog, contracts, and documentation tests
passed (nine intentionally ignored core tests).

The `redundant_closure_for_method_calls` slice passes `make format-check`,
`make lint`, `git diff --check`, and the full Rust workspace suite with the same
green test inventory recorded above.

The `clone_on_ref_ptr` slice passes `make format-check`, `make lint`,
`git diff --check`, and the full `nac-core` suite (1,156 passed, nine ignored).

Next: commit this exact lint boundary, then add `redundant_clone` and run
autofix before any manual repair.
