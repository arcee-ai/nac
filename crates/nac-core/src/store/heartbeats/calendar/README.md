# Calendar recurrence and pinned timezone data

This pure module calculates daily or selected-weekday/weekly occurrences at an
explicit local hour/minute and IANA zone. The existing-chat heartbeat service
uses it through persisted schedule models, controls, admission, native tools,
HTTP and human UI. That wiring is not full ALL-481 acceptance or publication.
Calendar-to-fresh-task integration remains separate (ALL-484). Existing elapsed
intervals and destination behavior are unchanged.

A gap is skipped, never shifted. A fold contributes its earliest UTC instant
only. `next` advances strictly beyond both now and the retained UTC due cursor;
the owning store binds that cursor to the exact schedule version and persists
occurrence identity atomically. Restart-safe admission, coalescing and receipt
persistence belong to the store/lifecycle owners and their integration tests,
not this pure calculation module.

The private search bound is 366 local dates per lookup; previews contain 1..=16
entries. Range, invalid zone/version/rule and search failures are errors, never
host-timezone fallbacks. These are calculation bounds, not new persisted or
public defaults. Preview carries UTC milliseconds and the corresponding local
datetime. No system clock or environment variable is read by the engine.

## Dependency and data ownership

Jiff is pinned exactly to 0.2.38, defaults disabled, only `std` requested. On
supported pointer-atomic macOS/Linux targets the active dependency is
jiff-core 0.1.2 with `std`/`alloc`. NAC selects MIT for both; see `NOTICE` and the
actual locked graph. Cargo also records inactive-target/optional dependencies;
lockfile presence must not be represented as active runtime feature selection.

NAC owns the embedded official IANA 2026f TZif pack and sorted name index under
`data/`. Only `scripts/timezone-data/generate.py` writes those files. It compiles
the pinned official tzcode, uses explicit fat TZif output and the main zone
sources plus backward links, excludes the unspecified Factory placeholder, and
never calls host zic or copies host zoneinfo. No leap-second table is added.
Runtime uses only `TimeZone::tzif` on this pack. Unknown names and data versions
fail; there is no system, Jiff bundle, POSIX-string, network or automatic-refresh
fallback. `data/LICENSE` and `data/NOTICE` preserve official public-domain and
named BSD exception notices. No tzcode/date/strftime implementation is vendored.

Initial source admission uses certificate-validated official versioned HTTPS
archives plus the full SHA512 values in the official release announcement:
https://lists.iana.org/hyperkitty/list/tz-announce@iana.org/thread/LPANPBYMCHJI4WKAII4J6BVXLCFVGRHM/
Both SHA256 and SHA512 pins are checked by the generator. Detached signatures
are retained in the private provenance packet but NOT cryptographically
verified; no valid-current-signing-key or signature-authentication claim is
made. This explicitly scoped source-admission decision is not a signature PASS.

Maintain updates deliberately: review the official release and provenance,
change the pins/version, inspect notices and actual target graph, regenerate,
and review rule changes/UTC fixtures and drift. Stored schedule rules retain
their data version. A later update must retain support for saved versions or
explicitly migrate and review affected schedules; never silently reinterpret
retained due identities or fall back to the host.

## Reproduce and verify

Place the two exact, previously admitted official archives in a private input
directory. Ordinary builds do not download or regenerate timezone data. From
the repository root, under the coordinator resource allocation:

```sh
python3 scripts/timezone-data/generate.py --archives INPUT_DIR --output crates/nac-core/src/store/heartbeats/calendar/data
python3 scripts/timezone-data/generate.py --archives INPUT_DIR --output crates/nac-core/src/store/heartbeats/calendar/data --check
cargo test --locked -p nac-core store::heartbeats::calendar
```

`--check` compares exact output filenames and bytes without rewriting them.
The generator's manifest records source hashes/options, pack/index hashes,
name/blob counts, sizes and provenance boundary. Regenerate twice to establish
same-host/compiler reproducibility; cross-platform generation equivalence is
separate evidence. Deterministic UTC fixtures cover LA gap/fold, selected
weekdays/weekly, Lord Howe's half-hour transitions, Kolkata/date boundaries,
Havana's 2026f no-fallback rule, invalid inputs, aliases, retained cursor and
bounded monotonic preview. Owning store/API tests and scoped human/native
journeys provide separate integration evidence. Cost, current-head full checks,
the whole wired review and public lineage/schema acceptance remain separate
gates; calendar-to-fresh-task acceptance remains ALL-484's work.
