# Unpublished hosted APT diagnostic candidate

This candidate has not been pushed or run in Actions. It is separate from all
published stack branches and from ordinary PR quality. Mechanism qualification
is unassigned; the campaign remains 14 measured mechanisms and 0-of-10 acceptance.
The measured local pair and its limitations are in `apt-transport-local.md` and
its companion JSON. Private local-probe commit:
`ce7a962b2989e1b0b5155763a17f81b0c469dccd`.

The new workflow triggers only on pushes to
`codex/all-582-apt-transport-probe`. It has no PR, dispatch, tag or default-branch
trigger. Permissions are read-only, checkout credentials are not persisted, and
there are no secrets, cache actions, package installations, sudo, Docker, provider
calls or production/test changes. Publication requires the owner's separate
review and authorization. No publication command has been issued.

One ordinary Ubuntu hosted runner performs Azure/official/official/Azure arms
sequentially. Each arm gets fresh private APT lists, archive directories, logs
and configuration below `RUNNER_TEMP`, outside the checkout/compiler caches.
The configuration prevents loading host APT config snippets and hooks, and
redirects every writable APT directory. The existing system dpkg status and
Ubuntu archive keyring are read-only inputs. A credential-clean subprocess
environment retains only PATH and locale; no inherited APT config/proxy/secret
environment is used. Thus this is a controlled transport comparison rather than
an exact replay of every hosted image APT hook/proxy or the old mirrorlist.

The runner must actually be Ubuntu 26.04.1, x86_64, unprivileged, with dpkg
architecture amd64 and nonempty actual ImageOS/ImageVersion/run identities.
Otherwise it fails and retains the reason. It records checkout source, actual
shell image identity, tool versions and executable SHA256 values. No image
upgrade or tool provisioning is attempted if that condition stops matching.

Every arm authenticates fresh base Resolute lists using normal date/signature
and Valid-Until policy, then downloads the identical nine exact package
versions with the historical amd64v3 filename variant. Both signed InRelease
and full package metadata/content hashes must match all four arms and the
committed corrected local pair's package pins; drift stops
the comparison rather than selecting replacement packages. The base Release
may omit Valid-Until, so no recent-publication claim is made. All nine .debs,
metadata, signatures, per-command stdout/stderr/times and failures are retained.
No archive is installed and no downloaded executable runs. Hash, signature and
missing-package negatives run once against real inputs.

Each child is limited to two allowed CPUs, 768 MiB address space, 1,800 CPU
seconds and 128 MiB per output/state file (the authenticated universe index is
77,706,789 bytes uncompressed). The whole controller bounds elapsed
time to 1,800 seconds between/within commands, private state to 768 MiB per arm,
retained output to 1 GiB, and host reserve to 13 GiB. The job has a 40-minute
outer bound. These are diagnostic controller limits; NAC/browser deadlines,
retries and real clocks are unchanged. The controller kills only a command's
own newly created process group on interruption/timeout, retains its output,
and fails. Temporary APT roots are cleaned on success and failure. Evidence
upload runs even on failure, has a source/run/attempt-specific name, performs
no overwrite and cannot become a PR verdict or a package/compiler cache.

A real local isolation control ran the same native APT configuration and
download commands as uid 65534 in the immutable Ubuntu container. All nine
actual archive/control hashes matched the corrected pair, and Docker's complete
writable diff contained only `/tmp/nac-apt-native`. The container was removed.
This validates the critical unprivileged APT path; it does not execute the
whole Python hosted controller or prove hosted-image/network parity. Its raw
receipt is local-only at the local packet's `native-unprivileged-control/`.
Five offline native-config/CLI/controller controls and eleven parsed workflow
positive and negative controls check isolation, exact trigger/source and failure
retention. The controller control kills and reaps a real owned child that ignores
TERM after its diagnostic timeout; Linux-only resource setup is excluded from
that Mac control, and remains pending actual hosted execution.

After authorization, one push of this branch would run the diagnostic. A valid
outcome needs actual source/run/image receipts, four exact-content arms,
negatives, cleanup and complete allocation/setup/transfer timings. Preserve any
failure. Even a successful hosted transport pair would not establish a
whole-CI improvement: a subsequent independently authorized production candidate
would have to retain all font content/native dependencies, locked Chromium,
one worker, zero retries and unchanged real production journeys. No proposed
setup optimization should reuse this diagnostic's quality result.
