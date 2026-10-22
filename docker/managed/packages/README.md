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

`package-runtime-apk.py` produces these five owned APKs with real ELF dependencies,
SPDX, verbatim notices and source/installed-file hashes. It uses the existing
Python standard library and APKv2 format; it is not a new package manager.
The local APKs are unsigned build products admitted only from the same image
build after archive/source checks. Supplier installation retains normal trusted
repository verification; retained archive control identities match the installed
APK database and bind the payload SHA256. CMU's SASL acknowledgement and GCC's runtime exception texts are
retained explicitly.

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
