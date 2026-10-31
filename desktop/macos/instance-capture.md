# ALL343 provisional capture fixture

This is an opt-in **test coordination prototype**. It does not qualify AppKit,
public XCTest screenshots, Darwin notification delivery, visible paint or OCR.
The default instance journey has no capture arguments, metadata I/O or AX writes.
Normal builds retain their nine Swift inputs; only `instance-*` builds include
the three capture implementation files. Rust and product execution are unchanged.

The complete acceptance obligation remains eight original cases, nineteen original
native diagnostic PNGs, nineteen primary public window PNGs and nineteen matching
public metadata attachments, with private before/after fences. A provisional
release means only that T may continue its existing journey. No release record,
notification, private fence or T summary means an image exists or was verified.

## Ownership and bootstrap

T owns `InstanceCaptureProtocol.swift` (finite state/binding),
`InstanceCaptureFiles.swift` (private no-follow records),
`InstanceCaptureNative.swift` (native hold and ephemeral AX metadata), and
`instance_capture.py` (manifest/bootstrap/forwarding). H owns its host controller,
Darwin notifications, immutable actor-bundle resource, capture-only XCTest actor,
public attachment collector, composition and catalog. Those H pieces are absent
from this prototype. No app/engine/browser/UI/XCTest run is implied by component
tests or compiler checks.

Before an eventual authorized run, H calls the T bootstrap with exact source
revisions and a fresh canonical directory. For example, substitute actual frozen
40-character revisions for `TARGET_SHA` and `HARNESS_SHA`:

```sh
python3 -B desktop/macos/instance_capture.py prepare \
  /private/tmp/OWNED-ATTEMPT/capture-metadata TARGET_SHA HARNESS_SHA
```

The parent must exist. The final directory must not exist. It is created0700,
with an immutable0600 `manifest.json` containing a fresh128-bit run nonce, exact
T/H revisions and all nineteen ordinal/key/track entries. No resume, subset,
replacement or regeneration of an attempt is supported. `evidence` and
`workspace` path components are rejected so these records cannot enter the
generic PID-cleanup directories. H must additionally keep its own actor exports
and metadata outside those cleanup namespaces.

H embeds this exact manifest (and any H-owned static app/test bindings) in its
own immutable test-bundle configuration. The actor must not read this directory,
T's app/profile/store/control files or a mutable H mailbox. Embedding/loading
that resource is an H implementation and selected-SDK evidence obligation.

H starts the original Python driver with
`NAC_INSTANCE_CAPTURE_DIRECTORY=/private/tmp/OWNED-ATTEMPT/capture-metadata`.
T requires the exact manifest source revision and original full ordered eight-case
selection, and publishes a single-use `admission.json` before any launch. A second
driver cannot reuse that admission, even if the first failed before its first
native episode. H must preserve the original700s driver,150s cleanup,70s controls and
40min job limits. This prototype's native hold expires after45s, below the
existing50s Python stage deadline. The20s drain-owner watchdog is unchanged;
selected-host latency may make the prototype fail that contract. No cap grows.

## Optional preparation before driver launch

The additive `CaptureRun.prepare_fixture(dev_app, stable_app, destination, observer)`
API copies **already built** instance-smoke bundles using filesystem operations
only. The H caller must first verify its exact clean T/H checkouts and matching
builder outputs. Preparation does not invoke Git, an SDK, console observation,
an app, an engine (including `--version`), configuration selection or a provider.
It creates no journey configuration, scenario profile or store. It does not
establish runtime or screenshot acceptance.

After creating the full manifest above, H can import this exact T module and call:

```python
from pathlib import Path
from instance_capture import CaptureRun

run = CaptureRun(Path(CAPTURE_DIRECTORY))
prepared = run.prepare_fixture(Path(DEV_APP), Path(STABLE_APP),
                               Path(FRESH_DESTINATION), Path(OBSERVER))
```

All paths must be absolute and canonical. The destination must be absent, with
an existing private owned parent; both input bundles and the observer stay
outside it. The destination contains one private `nac-instance-app-NONCE` root
and exactly the original two `Moved app with spaces N/NAC Instance Smoke.app`
layouts. Ordinary builder JSON/plist formats and0644/0755 artifact modes are
validated separately from private capture records. Symlinks, special files,
hardlinked files, foreign ownership, writable artifacts, unexpected entries,
changed inodes/bytes and mismatched source/track/build-support hashes fail closed.
The original private `Directory` record contract is unchanged.

Preparation exclusively publishes `preparation-admission.json` before creating
resources, then `preparation-resources.json` with the owned destination/root
identities. The final `prepared-fixture.json` uses closed schema
`nac343-prepared-fixture-v1`, exact manifest/run/preparation nonces, T/H revisions,
fixed source hashes, original and moved app inventories, observer identity/hash,
and final destination/root identities. Every private record remains canonical,
duplicate-free, immutable0600 JSON bounded to32KiB. The return value contains
`receipt` and the SHA256 of its exact bytes under `sha256`. No PID is authority.

H can now finalize and build its own immutable actor resource using those two
real moved URLs **before** starting T's driver. H owns that resource, actor build,
registration and public collection. This API does not modify any H implementation
or qualify selected SDK timing, AX, notification delivery or image collection.

H launches the existing wrapper/driver with its original arguments and limits,
adding `NAC_INSTANCE_PREPARED_SHA256=prepared['sha256']` alongside
`NAC_INSTANCE_CAPTURE_DIRECTORY`. The selector requires the capture context and
exact64 lowercase hexadecimal characters. The driver retains its actual Git
checks, revalidates the complete receipt against the original arguments and
current source/artifact identities, then exclusively publishes
`preparation-consumption.json` and the existing runtime `admission.json` before
console, SDK or product probes. It runs the original dev then stable engine
`--version` calls and all eight cases. Without this selector, the original
inline dev-copy/dev-version/stable-copy/stable-version order is preserved.

Each preparation and consumption is single use. Concurrent losers, failed or
interrupted preparation, missing registration, mismatched receipts and a gap
between consumption and runtime admission never permit retry, resume or inline
fallback. Partial preparation is quarantined; bounded failure records retain
the primary error and secondary reporting/descriptor errors when available.
An interruption before durable registration leaves resources **unproved**, even
if a directory was created. Runtime summaries explicitly retain this uncertainty;
legacy `fixture_retained=false` with `root=None` proves no cleanup or settlement.

On successful T runtime completion the existing fixture-root deletion still
runs. A later H collection/acceptance failure can therefore follow legitimate
deletion of the relocated apps. H must preserve attestations and surviving
metadata/diagnostics without recreating deleted originals or claiming they were
retained. Failed runtime keeps its known root; driver exit, absent first request
or an empty legacy audit establishes no app/CLI settlement. Raw T installs no
new SIGTERM handler: the existing H wrapper's real unwind boundary and exact
owner cleanup remain required. Preparation does not extend any deadline or
reduce the full eight-case/nineteen-pair acceptance obligation.

Each existing app episode creates one private `journey-NAME` directory before
launch. Its `configuration.json` binds the manifest hash, T/H revisions, run nonce,
exact frame subset for that existing episode, canonical resource root/store/app
URL, track and native/engine binary hashes. T passes only that directory and the
SHA256 of its exact canonical bytes as extra `--instance-*` arguments; those
arguments remain stripped from ordinary engine startup. The complete episode
subset is mandatory. Coexist dev uses16/19; stable uses17/18. The ten existing
native episodes and nineteen diagnostic capture points remain unchanged.

## Records and live state

All private JSON is UTF-8, sorted-key compact JSON without escaped slashes or a
trailing newline. Every record is at most32KiB, a private owned regular file with
one link. Directory components and files are opened no-follow/nonblocking with
retained directory descriptors. Reads reject replacement, special files,
noncanonical/duplicate JSON fields, foreign ownership or size violations. Writers
publish complete immutable records with Darwin `RENAME_EXCL`; they never replace
an existing record. Handles close on success, error and retirement. No filename
or PID in these records grants process-adoption, cleanup or execution authority.

At each original capture point, T saves its private state before taking the
unchanged native diagnostic PNG. It checks that state again, writes
`request-NN.json`, then exposes metadata on the existing window:

- Accessibility identifier: `nac343.capture.phase`.
- Accessibility value: compact JSON, at most2048bytes, schema
  `nac343-public-phase-v1`.
- Public fields: run/request nonces, ordinal/key, manifest/config/request hashes,
  track, app PID/incarnation/launch epoch and window number. There is no private
  store path, engine endpoint, profile token or receipt in the AX value.

`request-NN.json` uses schema `nac343-capture-request-v1`. It contains the same
finite identity, configuration/manifest digests and a `before` private state.
`request_sha256` always hashes its exact full file bytes; the request does not
contain its own hash. The request nonce is fresh for each native capture.

The private snapshot binds the canonical store/root/bundle and track, app/window
identity, geometry, exact engine PID, serving receipt incarnation/store/schema/
version/identity, loopback origin/document URL, conflict episode, loading and
reopen state. Native validity checks require the owned visible key window and
either the exact serving receipt or the retired matching conflict. A changed
private field, cancellation, retirement or changed configuration fails the hold.

While waiting for an ordinary stage, the existing Python driver scans these
retained requests and writes immutable `forward-NN.json` in the capture root.
It validates all bindings, rejects reordered frames without a predecessor fence,
and treats repeated scans as idempotent. No edge count advances a frame. H reads
the forwarded pointer and the original private request/configuration; it does
not read a guessed profile or infer an owner from a PID. H must validate the exact
owned app/window/console and request before and after coordinating a screenshot.

H alone may write `provisional-release-NN.json` inside the journey directory.
Its **exact** fields are:

```json
{"schema":"nac343-provisional-release-v1","run_nonce":"...","request_nonce":"...","ordinal":1,"key":"simultaneous/workspace","configuration_sha256":"...","request_sha256":"..."}
```

Serialize canonically as above; this illustrative field order is not canonical.
Unknown fields (including `captured` or `verified`), stale/wrong-run/request/frame/
configuration hashes, booleans in place of ordinals and duplicate releases are
rejected. A correctly matched early release is intentionally permitted for test
scheduling, even when no actor/image exists. It grants no capture acceptance.

T rechecks private state at consumption, clears the public AX value and identifier
**before** publishing `fence-NN.json` or returning to the original journey, then
advances its finite local state. The fence retains the exact request hash and
equal `before`/`after` snapshots, `release: "provisional"` and
`capture_verified: false`. A failed hold clears the phase and emits a retirement
record where safe. Host cleanup writes `retirement.json`; native stop/error also
retires the phase and state. Metadata failure never skips the original owned-app
and engine cleanup. Forced app death needs no notification cleanup token: the
actor must reject a vanished/replaced app incarnation.

Cleanup owners attempt the drain barrier, every app journey in the original
reverse order, and the exact owned CLI independently, even if metadata retirement
or another cleanup fails. A journey likewise attempts its app/engine observations
and log close after a metadata failure. Observation failure does not authorize
adopting an unobserved app or PID. A pending operation exception remains the
primary exception; cleanup failures are retained on it separately. Without an
operation failure, the first cleanup error fails the case after later owners
have been attempted. No returned cleanup call is presented as settlement proof.
Failure summaries retain `operation_failure`, up to32 `cleanup_errors` with owner,
type,512-character message prefix, full-message byte count/SHA256, and the truthful
`cleanup_error_count`/`cleanup_errors_truncated`. This does not relax any cleanup
observation, resource guard or deadline, or turn unproved cleanup into success.

## H notification and acceptance obligations

T allocates **no Darwin notification tokens**. H's existing controller and
capture-only actor own registration, bounded initial-state scans/rehints and
token cancellation. Apple documents public `notify_post`/`notify_register_dispatch`
as stateless shared notifications, which may coalesce. Passive checks may give
false positives and initially return true. A same-UID notification name and a
fresh nonce do not authenticate the sender. The local CLT26.5 declarations do
not qualify notifyd access from the selected Xcode26.6 XCTest runner.

H must register host listeners before starting the actor. The actor registers
its finite request names before posting its ready hint. Neither hint proves
readiness to the host. Use a fresh run namespace and fixed frame-name mapping;
callbacks only prompt re-reading the current exact state. Never infer an ordinal,
capture completion or permission from callback counts/status. Missing wakes need
bounded state rescans/same-frame rehint; duplicates must not repeat captures or
T actions. Denied access or unrecovered loss fails within existing deadlines;
there is no permissions/entitlements/grants/network/product-bridge fallback.

The actor only observes public AX metadata and takes public screenshots of the
exact owned foreground window. It checks the run/frame/request/app/window before
and after each screenshot and emits named in-memory PNG/metadata attachments.
It never launches, activates, resizes, clicks, retries, terminates or writes a
foreign file. Its done hint is only a wakeup. A spoofed early done may release a
hold too early; acceptance must then obtain correct paired evidence or fail.
A phase that disappeared/advanced during the screenshot cannot qualify that image.

After the test, H must export the actual selected test's public attachments and
require all19 unique PNG/metadata pairs with exact source/config/request/frame/
app/window bindings and image hashes, matching T's private fences. Zero, partial,
duplicate, reordered, stale or mismatched output is failure. T's final summary
can report nineteen provisional releases, but always says `capture_verified:false`
and `final_public_pairs_required:19`. H remains the sole collector writer.
Retain all19 native diagnostic PNGs as diagnostics. Existing2MiB-per-PNG,
12MiB aggregate and256KiB text limits remain effective.

Component tests cover the private protocol, file boundaries, disabled-mode
command equivalence and owned Foundation-only process interchange. They do not
prove real AX exposure/refresh, screenshot latency/paint/OCR, selected XCTest
notification access, app shutdown/watchdog timing or full8/19 acceptance. A
separately authorized selected-host proof is still required; a small proof never
replaces the full matrix.

Primary references: [Apple dispatch registration](https://developer.apple.com/documentation/darwinnotify/notify_register_dispatch(_:_:_:_:)),
[Apple libnotify manual](https://raw.githubusercontent.com/apple-oss-distributions/Libnotify/main/notify.3),
and [public XCTest accessibility attributes](https://developer.apple.com/documentation/xcuiautomation/xcuielementattributes).
