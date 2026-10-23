# Current-contents qualification (ALL-417)

This is a **nonshipping qualification oracle**, not a capture API, launch engine,
checkpoint service, or production adapter. No runtime imports it. It accepts no
user checkout argument; the runner creates disposable repositories itself.
The maintained contribution is regression evidence of a FAIL verdict.

From repository root after `make setup`:

```sh
make test-capture-qualification
cargo test --locked -p nac-core --test current_contents_characterization
cargo test --locked -p nac-core qualification_tests
python3 scripts/capture-qualification/run.py --output /tmp/all417-evidence.json
```

Python standard library, POSIX/macOS or Linux, Git, and Rust are sufficient.
The tests include about 128 MiB of temporary data for actual default boundary
fixtures; benchmarks add four sequential fixtures with 10,000 ignored files each.
No privileged device creation, Docker, remote hosts, or model credentials are used.
The runner exits nonzero on broken assertions. Its JSON verdict is FAIL because
successful characterization tests demonstrate unmet production contracts.

- `probe.py` inspects selected filesystem entries with descriptor-relative
  no-follow reads and a pruned inventory. Two scans observe changes, but do not
  establish OS atomicity or a complete capture protocol. Git output and each
  directory listing are buffered: this oracle does **not** prove incremental
  enumeration/output-memory bounds or total-time supervision across two passes.
- `test_contract.py` exercises selected supported entries, explicit rejections,
  mutation barriers, actual/scaled numeric boundaries, supervised process timeout,
  interruption, source loss and a deliberately isolated fake admission observer.
  The fake observer is an executable fail-closed example, not evidence that NAC
  has durable request identity, initial-input-once or launch recovery.
- `run.py` measures a command-equivalent history recipe after safe-fixture
  preflight. It compares raw `git archive` entries with byte/type/mode hashes and
  records source HEAD/index/manifest hashes before/after. It does not run checkout
  filters or prove destination worktree preparation. Actual NAC helper behavior
  is exercised separately by Rust tests.

The report and checked-in example evidence are in
[`docs/current-contents-qualification.md`](../../docs/current-contents-qualification.md).
Reproduce measurements instead of treating one host's timings as an SLA. Fixture
creation warms the OS cache; “first” means first private index, not cold disk.
Logical byte counts and child OS block counters are distinct; physical sizes use
`st_blocks * 512`, which does not measure APFS exclusive allocation or compression.
