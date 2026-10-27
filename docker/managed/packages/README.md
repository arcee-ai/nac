# Owned managed-runtime packages

These temporary APK replacements preserve the current tool profile while
applying reviewed source corrections. The image builds them locally; nothing
publishes a package repository or installs host tools. APK installation replaces
the original files in the same runtime layer, rather than leaving a second
unpatched library elsewhere on the final filesystem.

`sources.lock.json` is the reviewed input inventory: upstream release/commit,
download URL/SHA256, source patch and NAC downstream APK revision. Revisions such
as Kerberos `1.22.2-r6` are NAC packaging revisions, not a claim that upstream
released 1.22.3. Accepted upstream commits and maintained downstream corrections
are distinct fields. SASL uses Debian's accepted patch; its equivalent upstream
proposal is still closed and unmerged.

Each `build-*.sh` owns one component's normal source build or exact header
replacement. Kerberos runs its ordinary upstream `make check`; fixture skips
remain visible in its build log. Its 23 library/plugin paths match the original
installed package scope. SASL preserves the existing Heimdal/plugin configuration.
The GCC package changes the one affected template header in the exact checksum-pinned
supplier development payload. Curl restores supported SSH/LDAP/NTLM/zstd options;
Allison accepted upstream RTMP, SMB/SMBS and TLS-SRP removals on October 22, 2026.

`package-runtime-apk.py` produces these six owned APKs with real ELF dependencies,
SPDX, verbatim notices and source/installed-file hashes. It uses the existing
Python standard library and APKv2 format; it is not a new package manager.
The local APKs are unsigned build products admitted only from the same image
build after archive/source checks, with networking and repositories disabled.
Supplier providers are installed first through normal trusted repository
verification; retained archive control identities match the installed
APK database and bind the payload SHA256. CMU's SASL acknowledgement and GCC's runtime exception texts are
retained explicitly.

The trusted runtime install pins the supplier predecessors, including GCC's
compiler, runtime libraries and development headers. Immediately before owned
package admission, `check-supplier-packages.py` compares the actual APK database
with every source owner's `supplier_packages` inventory. Missing, duplicate or
different versions fail the build. `supplier-predecessors.json` retains the
observed versions and database SHA256; a rolling repository update requires an
explicit baseline/source review instead of silently downgrading the runtime.

The final image contains:

- `/usr/share/nac/package-provenance/*.json`: each owned package's source, patch,
  supplier and actual installed payload hashes/symlink targets.
- `/usr/share/nac/runtime-package-build/`: exact owned APKs, archive checksums,
  source lock and build/packaging recipes.
- `/usr/share/nac/runtime-provenance.json`: all installed APK identities, verified
  archive hashes, embedded recipe/PKGINFO and active vendor SPDX references,
  plus actual installed notice-file hashes.
- `/usr/share/nac/vendor-package-metadata/`: retained supplier metadata. Original
  supplier binary payload archives are not kept as hidden runtime copies.
- `/usr/share/licenses/`: verbatim notices for owned source components, alongside
  the supplier/tool notices already installed.

These records prove inputs, ownership and file integrity. They do not establish
vulnerability applicability or create a scanner ignore/exception. Full image
inventory/policy and normal runtime acceptance remain separate requirements.

Build the owned packages with ordinary Docker:

```sh
docker build --platform linux/amd64 --target runtime-packages \
  -f docker/managed/Dockerfile -t nac-runtime-packages:local .
```

The complete image and existing smoke use the normal root Make targets. The
additional benign runtime smoke checks compiler execution, GNU/OpenSSL ABI,
Python venv/SSL, Node/UTF-8, plugin loading and recorded installed-file hashes.
It does not perform malformed-protocol or exploit validation.

Retire each backport when a maintained supplier package demonstrably contains
the correction and preserves the required runtime profile. Retire the custom curl
build when the supplier enables the supported options NAC retains. A version
number or an apparent zero-match scan alone is not retirement evidence.

## Brotli and npm graph corrections (ALL-500)

The runtime pins all three supplier Brotli libraries to `1.2.1-r2`, built from
upstream `db24a98aed38a16de78cc05ca15cdd8dc2a0d92d` under MIT. Their actual
downloadable supplier archives, retained recipes and installed-file identities
are bound by `brotli-supplier.lock.json` and the ordinary runtime provenance.
The runtime smoke checks the decoder's new block-switch error and shared-library
versions plus encoder/decoder roundtrip. Supplier epoch 2 runs upstream ctest.

The latest available npm 11 parent is still `11.21.1`; upgrading Node or npm 12
does not correct this separate bundled Undici copy. `npm-bundle.lock.json` pins
the existing npm archive and two MIT patch releases: Undici `6.29.1` and
ip-address `10.7.4`. Their parent requirements remain `node-gyp: ^6.25.0` and
`socks: ^10.1.1`, respectively. Neither replacement has runtime dependencies.
The bounded installer checks those predecessor/consumer identities, archive
checksums, exact metadata and licenses before replacing each directory. It
retains every corrected installed file's hash and the source lock separately
from npm's unchanged upstream version; it does not claim an upstream npm release.
The published npm tarball contains no npm lockfile to update. The pinned parent
archive plus the correction lock describe the exact downstream graph.

The image build checks the parent Undici failure and corrected behavior in
isolated loopback processes; runtime smoke rechecks the corrected copy and local
offline npm packing. No registry installation or script execution resolves a new
graph. Original vulnerable npm/Undici archives are deleted, and corrected
libraries replace their supplier files through normal trusted APK installation.
Retire this npm correction when an actually available same-major parent bundles
the fixed versions and passes the same compatibility checks. All raw scanner
findings remain reportable; these checks never grant applicability clearance.

## libssh2 maintenance chain (ALL-501)

The supplier still serves `1.11.1-r11` without the six selected corrections.
The owned `1.11.1-r12` is a NAC packaging revision, not an upstream release or a
claim about supplier epoch 12. It starts at the same upstream release commit
`a312b43325e3383c865a87bb1d26cb52e3292641` and keeps BSD-3-Clause COPYING verbatim.
The predecessor archive hash and recipe commit are recorded in the source lock.

The build preserves the supplier's CVE-2026-7598/55199 fixes using Debian's
1.11.1 adaptations of the same accepted upstream changes, followed by the
supplier's CVE-2026-55200/2025-15661 patches. Those latter files are checksum-bound
to a public Wolfi revision; their contents were compared with the supplier recipe.
The six selected CVE-2026-66032/66033/66034/66035/58050/58051 corrections come from
the checksum-bound Debian 1.11.1-1+deb13u2 patch archive. Each upstream commit and
exact archive member is retained separately. The 58051 Debian header names
32092f0d, while the equivalent accepted upstream object is a9758da4; the source
lock does not present these as the same history object.

Two small NAC adaptations retain 1.11.1's API names and control flow while
applying upstream follow-ups: c2f1a3a plus ad16eb1 initialize all grown list
entries including the terminator and release attrs-only entries; a0334dbe
replaces out-of-object pointer comparisons with integer offsets. Each local
patch and the six corrected source files have reviewed SHA256 identities.
Every patch must apply without fuzz. No arbitrary master snapshot is substituted.

The builder runs ordinary upstream standalone/local OpenSSH tests; Docker tests
are unavailable inside that build stage and remain a stated coverage limit.
A bounded benign fixture exercises the exact staged curl/libssh2 bytes with
SSH commands and SCP/SFTP upload/download under AES-GCM and AES-CTR/ETM. It uses
upstream's public test keys only in the disposable builder, whose test account
configuration is not inherited by the separate runtime stage. Runtime smoke
binds installed payload hashes, loads libssh2, and verifies OpenSSL4 and curl
dynamic consumer linkage. Dedicated malformed-input regressions and 32-bit
execution are separate acceptance evidence; ordinary tests do not establish
them. No blocked applicability regression work is delegated to this build.

libssh2 becomes a sixth owned APK with the scanner's corresponding exact owned
package, canonical upstream CPE and plain-upstream Wolfi search identities. The
same strict missing/unknown-owner checks remain effective. Physical
backports may retain conservative `<=1.11.1` findings; neither NAC's revision nor
these provenance records waive them. Retire the backport only after a supported
supplier includes this full correction/follow-up chain and preserves the ABI and
required SSH capabilities.
