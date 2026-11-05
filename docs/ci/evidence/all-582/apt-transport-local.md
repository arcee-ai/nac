# Private APT transport comparison

This unassigned experiment supports one prospective hosted comparison. It changes
no workflow, package installation, browser revision or production journey. It
does not change the campaign's 14 measured mechanisms or 0-of-10 acceptance.
The companion JSON carries exact package versions, sizes, SHA256 values,
timestamps, image identity and local-only raw locators.

The actual baseline is run `42078117303:1`, job `127423786449`, source
`57f08f8442bdb1186b99958a178edc1c9e104368`. Its Chromium installation step took
672 seconds. APT reported `Need to get 21.9 MB` and then `Fetched 16.6 MB in
10min 54s`; those distinct labels are retained without inferring their difference.
The Chromium/CDN phase took about 10.10 seconds. This observed stall was in APT
font/X-font transport; a Chromium archive cache would not address that phase.

The corrected local pair downloaded 21,857,278 bytes per arm. Azure archive
transfer took 18.145 seconds and `archive.ubuntu.com` took 2.233 seconds; index
updates separately took 3.364 and 3.009 seconds. Both fresh containers used the
same immutable official Ubuntu 26.04.1 amd64 image and signed Resolute base
InRelease. Every archive's version, control architecture, size and SHA256
matched between arms. `xfonts-utils` specifically used the hosted filename
variant `_amd64v3.deb`, whose actual control architecture is `amd64`.

These are single, fixed-order local Mac Docker measurements, Azure first. The
host is ARM64 and the containers are emulated amd64. The complete GitHub runner
image and Azure routing were not reproduced. The previous local pair remains
in `pair-first`: it verified internally matching packages but selected the
generic amd64 utility archive, so it does not qualify as the exact hosted
selection. A focused offline control now rejects that variant. Neither pair
attests historical archive bytes, because the hosted log retained no signed
index hashes; the hashes here are prospective authenticated pair pins.

The probe retains normal APT signature, date and Valid-Until checks and refreshes
lists with `update --error-on=any`. It also explicitly verifies InRelease with
the image's Ubuntu archive keyring. The immutable base Release is dated
2026-04-23 and has no Valid-Until; this is not a claim that the base index was
published recently. Updates/security indexes and package installation are
outside this narrow transfer probe. No insecure/trusted-source flag or expiry
override is used. No package is installed and no downloaded executable runs.

Real negative controls reject a wrong expected hash against a downloaded
archive, a changed signed Release (`gpgv` exit 1 with `BAD signature`), and a
nonexistent package (APT exit 100 with the expected missing-package diagnostic).
Six offline controls also guard source alignment, missing/ambiguous versions,
unauthenticated metadata and an unpinned image CLI input. Failures are retained
and stop the experiment; it has no retry wrapper.

Run only with an existing Docker Engine and this already acquired image:

```sh
python3 .github/scripts/apt-transport-probe.test.py
python3 .github/scripts/apt-transport-probe.py \
  --image docker.io/library/ubuntu@sha256:157dc3d6e4a3e4f2c68d12df9df9ed6e808b59af6d4c3757b432b4f519916725 \
  --source 57f08f8442bdb1186b99958a178edc1c9e104368 \
  --output /absolute/new/private/output
```

`--source` labels the retained NAC source; the report separately hashes the
probe itself. Output must be a new directory. The controller uses only Python's
standard library, an existing Docker CLI and tools already in the pinned image.
It creates one uniquely named container at a time, at 2 CPUs, 768 MiB memory
with equal memory-plus-swap, and 128 PIDs. It stops at a 13 GiB host-free guard,
1 GiB owned output, 768 MiB container writes or 1,800 seconds. Corrected observed
container writes peaked at 58,204,160 bytes. Both containers were removed;
host free space afterward was about 20 GiB. Only these owned containers are
removed. Other caches, containers, images and settings remain untouched.

A next experiment could compare the same package transport on actual Ubuntu
GitHub runners using Azure versus the alternate official archive route, with
fresh private lists/archive directories and exact signed package pins. It must
retain all fonts and their content, normal signed-index freshness checks,
Chromium revision/native dependencies and the unchanged production journeys
with one worker and zero retries. Compare setup and whole-path time separately,
record image/region/source and stop if package identity or signed sources drift.
This requires a separately authorized candidate and hosted execution; neither
has happened here. Local timings do not establish mirror-versus-runner causality
or a hosted benefit. APT transport overlaps browser setup in S02/S09; Chromium
CDN caching and compiler/image caching are different mechanisms. No additional
strategy qualification is assigned by this packet.
