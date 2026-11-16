# Retained interval tasks

In a saved Local project, open **Interval tasks** to schedule repeated work in
separate retained direct tasks. Each occurrence uses the saved instructions and
skills, and records its exact initial run and result. Git projects keep separate
checkouts for inspection and later human work. Non-Git Local projects share
their existing directory and show that behavior. See [retained isolated tasks](retained-tasks.md)
for source selection and preparation ownership, and [heartbeats](../heartbeats.md)
for interval cadence and schedule controls.

## Retained-resource allowances

The defaults are **10 retained resources per schedule** and **100 host-wide**.
These are finite resource-count allowances. Repository size, task output and
retained history determine the storage needed for each resource; choose suitable
lower allowances or sufficient storage headroom for the actual workload.

Reservations and partial preparations consume allowance, including resources
whose task rows were deleted. At the limit, the schedule suspends **before
another preparation** and exposes its owned inventory and the action needed.
Deleting a task keeps its retained resource and does not make that capacity
available again.

Inspect the inventory before making an authorized allowance change or using a
separately authorized resource lifecycle. An allowance increase does not resume
a suspended schedule: **Resume** is a separate action. Normal ownership,
permission and readiness checks still apply. There is no automatic pruning,
archive, deletion or implicit resume.

## Measured default rationale

The existing 10/100 defaults were retained on November 4, 2026 after a bounded
Local busy/coalescing, quota, deletion, reopen and recovery series. The normal
engine was `6f912fdf34a1`; test source was `456e87060338`. One 8 MiB repository
produced three retained resources. Deleting one task retained its checkout;
reopening and raising the host allowance did not recreate work or resume the
schedule. A separate Resume and intentional run created the third resource.
The host allowance exercise was two to three resources; 100 materializations
were not exercised.

| Measurement | Baseline | Three retained resources | Growth |
| --- | ---: | ---: | ---: |
| Logical file bytes | 17,533,042 | 42,807,821 | 25,274,779 |
| `stat_blocks` allocation estimate, bytes | 17,653,760 | 43,122,688 | 25,468,928 |

The inventory deduplicated filesystem device/inode identities and counted
source/shared Git data once. Filesystem, HTTP and SQLite observations were
separate snapshots. APFS shared extents and compression prevent these allocation
estimates from establishing exclusive physical usage. Larger repositories,
outputs, history and unrelated disk use can exhaust storage earlier. The count
defaults do not provide a byte quota or a universal capacity guarantee.

The scheduler test passed all ten phases. Its external observer recorded an
`ENOENT` and `HOLD_UNKNOWN`; independent process/endpoint closure was verified,
then the original tool session was retired with exit 130. That observer failure
remains recorded. New partial-preparation samples were zero; partial retention
keeps its earlier R2/allowance characterization. This series supplies bounded
retained-growth evidence, without CPU, latency or endurance qualification.
