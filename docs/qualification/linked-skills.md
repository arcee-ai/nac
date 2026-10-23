# Local direct linked-skill qualification

ALL-419 qualifies explicit skill expansion and safe Local resource access. The
result is a supported subset: a linked package can be discovered, explicitly
expanded, and read through NAC's ordinary permissions. Directory installation
does not certify a package's workflow. No catalog eligibility was broadened.

## Revisions and environment

The October 23, 2026 run used macOS arm64, Rust 1.98.0 and Python 3.14.8:

- NAC implementation and repository skill bytes:
  `90be848ba3f0410b5e697bb60f4d71a935216361`, freshly fetched `origin/dev`.
  This qualification adds tests/documentation without changing the loader,
  permissions, execution backend, or public session behavior.
- Clean shared catalog: `arcee-ai/arcee-skills`
  `632bde23f012189992091baec47d155090d3e810`.
  The local durable checkout was `/Users/allison/git/allison-gerred-skills`.
- Actual installed root: `/Users/allison/.agents/skills`, with **11** directory
  symlinks to that checkout. These were inspected read-only and reproduced in a
  temporary home. The real installation, subscriptions and profiles were untouched.
- `make setup` completed before development. The tests create disposable project,
  home/config paths and session databases, and restore their process environment.
  Each case runs in its own test subprocess so its temporary HOME/NAC_HOME
  cannot affect concurrent process tests in the parent test binary.
  No production sessions, provider credentials, real connector operations or
  release/triage mutations are used.

The catalog manager's read-only `catalog --client nac` output includes partial
NAC declarations elsewhere, including `allisoneer/linear-reporting`; that package
was **not installed** in this snapshot. Of the 11 installed packages, only
`shared/arcee-skills` is installation-eligible for NAC via its `portable`
declaration. NAC nevertheless discovers all 11 through its user fallback tree:
the scanner does not read the sidecar.

## Installed availability matrix

All links below are relative to the catalog checkout. Each installed package
was discovered, explicitly `$`-expanded into the model request and read with
NAC's native `read`, including every listed resource. These results are
**availability evidence**, not end-to-end workflow certification.

| Installed name | Canonical catalog directory | Declared clients | Workflow limit in this qualification |
| --- | --- | --- | --- |
| arcee-skills | `skills/arcee-skills` | portable | Setup instructions and root-resolution script readable; installer/profile mutations unexercised |
| collaboration | `contributors/allisoneer/skills/collaboration` | codex, claude-code | Continuing Slack coordination unexercised |
| feature-shaping | `contributors/allisoneer/skills/feature-shaping` | codex | Product-discovery workflow unexercised |
| goal-prompt | `contributors/allisoneer/skills/goal-prompt` | codex | No NAC goal adapter qualified here; ALL-422 remains separate |
| linear-planning | `contributors/allisoneer/skills/linear-planning` | codex, claude-code | Relative planning references readable; tracker operations unexercised |
| parallel-work | `contributors/allisoneer/skills/parallel-work` | codex | Native peer coordination and task orchestration unqualified |
| pr-ready | `contributors/allisoneer/skills/pr-ready` | codex, claude-code, cursor | Relative review references readable; NAC PR/review workflow unexercised |
| slack | `contributors/allisoneer/skills/slack` | codex, claude-code | Connector discovery/delivery unexercised |
| spawn-codex-task | `contributors/allisoneer/skills/spawn-codex-task` | codex | Requires Codex desktop task APIs; ALL-420 owns adaptation |
| stacked-prs | `contributors/allisoneer/skills/stacked-prs` | codex, claude-code, cursor | Git/gh stack workflow unexercised |
| vertical-slices | `contributors/allisoneer/skills/vertical-slices` | codex | Planning/execution composition unexercised |

Repository `qa`, `release`, and `triage` were exported from the exact NAC commit
above into the temporary project's `.agents/skills`. All three were discovered,
expanded and read, with no supporting `scripts/`, `references/` or `assets/`
files at that revision. Their full workflows were deliberately not executed:

- `qa` describes orchestrator/worker choreography and rootless Podman. Loading
  its text does not prove direct-mode choreography; ALL-423 owns that adaptation.
- `release` describes a stable release workflow tied to historical main/workflow
  assumptions. Reading it supplies no release authority or current release proof.
- `triage` requires GitHub inventories and authorized issue mutations. None ran.

The source run verified **27 native reads**: 14 entrypoints plus 13 package
resources. This includes the real shared `arcee-skills/scripts/repository_root.py`
and relative references in planning, review and other installed packages. Real
catalog scripts were read, not executed. The normal fixture separately executes
a task-owned Python script that only prints a marker.

## Exercised capability matrix

The qualification uses the real runtime constructor, `Agent::send`, explicit
prompt preparation, permission broker, prepared native tools and loopback
Responses provider double. Tool selection and the final text are scripted.
Assertions inspect actual requests/results, not a model's claims of success.
This does not qualify discretionary model skill selection, the UI, HTTP run
admission, or end-to-end external service workflows.

| Case | Observed result | Evidence |
| --- | --- | --- |
| Four roots with the same frontmatter name | `.nac/skills` > project `.agents/skills` > isolated `NAC_HOME/skills` > isolated home `.agents/skills`; first wins with shadow warning | `all_four_roots_shadow_in_order_and_registry_retains_loaded_bytes` removes each winner and reloads |
| Required frontmatter and colon repair | Name, description and compatibility retained; description containing an unquoted colon repaired | Qualification fixture plus neighboring `skills::frontmatter` characterization |
| Invocation metadata and sidecar | `disable-model-invocation: true`, `user-invocable: false`, `allowed-tools` and Codex-only sidecar do not block explicit expansion or grant the named tool | Direct fixture explicitly expands; unavailable connector returns unknown-tool error |
| Explicit invocation | Repeated `$linked-demo` injects one block; literal prompt stays intact; unknown `$not-installed` stays literal; real linked directory and resource list appear | Captured direct provider request and prepared prompt |
| Ordinary text / automatic use | Prompt preparation leaves ordinary text unchanged; direct system prompt supplies no available-skills catalog | Direct fixture; no automatic-selection workflow claimed |
| Linked resource and script inside workspace | Native reads return their markers; trusted inert script returns exit code 0 | Direct fixture using a directory symlink and relative package paths |
| Missing referenced resource | Package still loads; missing resource is absent from resource listing; attempted native read returns `not_found` without revision | Direct fixture |
| Unsupported capability | Declaring a tool in frontmatter does not register it; actual tool call returns unknown-tool error | Direct fixture; no MCP connector mounted |
| External symlink with default permissions | Body discovered and expanded; resource read fails closed because external-directory approval has no interactive approver | External-resource fixture |
| Explicitly selected canonical read target | Exact temporary file allowed by fixture configuration is readable through its link; lexical link-path allow alone is insufficient | External-resource fixture; no directory-wide allow |
| Configured Deny | Exact canonical read Deny blocks even with external-directory Allow; marker never returned | External-resource fixture |
| Retained registry | Body remains original after source edit; fresh load sees updated body; subsequent resource read sees updated disk bytes | Direct fixture and retained-registry fixture |
| Actual catalog and clean repository skills | All 14 selected skills explicitly expanded; all 27 native reads match source content and have revisions | Opt-in exact-source test |
| SSH / Podman | **Unqualified** | No remote/mount test performed; Local success supplies no remote guarantee |

NAC has no skill-specific allowed-root bypass. Local native reads canonicalize
the target and apply ordinary read/external-directory policy. The exact-file
allows in these tests are temporary, explicitly selected fixture inputs; they
do not change the real user's rules or turn discovery into authorization.
Interpreters are broad code authority: the inert script exercise explicitly
trusts that exact command through the fixture policy. Frontmatter supplies no
such authority, and reading a script never authorizes executing it.

## Reproduce

From a setup-complete checkout of this PR, run the portable-infrastructure Local
fixtures (Unix plus `python3`; no catalog, credentials or connector required):

```sh
cargo test --locked -p nac-core skills::qualification -- --nocapture
```

Four tests run, including stable Git inspection across fixture home changes.
The real-source test is ignored by default because personal
paths and a reviewed catalog checkout are not CI inputs. To repeat that test,
provide explicit existing read-only paths and full immutable revisions. The
catalog must be clean and its HEAD must equal the supplied catalog SHA. The
NAC source may be the current checkout: only committed skill bytes from the
supplied SHA are exported, excluding local changes.

```sh
env NAC_QUALIFY_CATALOG=/absolute/reviewed/catalog \
  NAC_QUALIFY_INSTALLED=/absolute/installed/skills \
  NAC_QUALIFY_SOURCE=/absolute/nac/checkout \
  NAC_QUALIFY_CATALOG_REV=632bde23f012189992091baec47d155090d3e810 \
  NAC_QUALIFY_SOURCE_REV=90be848ba3f0410b5e697bb60f4d71a935216361 \
  cargo test --locked -p nac-core \
  skills::qualification::sources::exact_catalog_links_and_repository_skills_are_discovered_expanded_and_read \
  -- --ignored --exact --nocapture
```

The opt-in test rejects installed links outside the selected catalog. It reads
all selected package resources as text, so an installation with binary assets
or files above native read limits requires a separately scoped fixture. A
different revision/set is a new observation; retain its emitted revision,
package/client inventory and read count instead of inheriting this snapshot's
results. No installer, subscription, metadata, checkout or profile edits occur.

## Supported-use recipe and bounded follow-ups

1. Use a reviewed package compatible with the intended workflow and actual
   tools. Consult the catalog's declared clients separately from NAC discovery.
   Do not install or broaden metadata merely because its Markdown can load.
2. In a Local direct session, identify the selected skill name and discovery
   path. Audit higher-precedence collisions; explicitly submit `$name`.
   Ordinary matching prose does not establish automatic invocation support.
3. Resolve the displayed relative reference against the displayed skill
   directory, then request the exact file with native `read`. Inspect actual
   returned content/revision. If the target is external, approve the exact
   intended access through existing permissions; a headless Ask is a failure.
   Honor Deny and never evade it with shell reads or wider roots.
4. Inspect a script before any separately authorized execution. Expect
   interpreter/broad-command approval. Treat skill text and metadata as
   instructions/data, never additional authority or a credential source.
5. Report missing resources and unavailable tools precisely. Keep the supported
   subset and unexercised portions visible. Reconstruct the runtime to refresh
   the loaded registry after package changes; package resources remain live.

Concrete gaps are invocation-policy enforcement (those Codex fields are
unparsed), automatic direct skill selection/catalog exposure, external-resource
approval requirements, and per-workflow native-tool adapters. None warrants
loosening roots or broad catalog migration in this ticket. An invocation-policy
change needs its own product contract and parser/enforcement tests; task/goal/QA
adaptations remain ALL-420/422/423, broader workflow qualification ALL-421, and
broad portability ALL-395. No new gap tickets or adjacent implementations were
created. Local explicit availability is qualified; full catalog workflow
compatibility and SSH/Podman support remain unqualified.
