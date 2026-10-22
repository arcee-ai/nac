# Dependency remediation decisions (ALL-462)

Allison approved these choices on October 21, 2026 after the comparison in
[ALL-462](https://linear.app/arcee/issue/ALL-462). The implementation preserves
NAC's tools, session behavior, backend selection and public OpenAPI 3.1 contract.
This record explains selection and maintenance obligations; it does not certify
the candidate's CI, image inventory or publication readiness.

## Source dependencies

| Owner / purpose | Choice and declared license | Reason, risk and maintenance trigger |
| --- | --- | --- |
| Server delivery: collect routes and schemas, serve protected `/docs` | `utoipa` 6, `utoipa-axum` 0.3, `utoipa-swagger-ui` 10.0.2; MIT OR Apache-2.0 | Supported parents replace abandoned paste with pastey and upgrade zip to patched 9.x. Retain disabled Swagger defaults and axum/vendored. Keep OpenAPI 3.1, regenerate through the sole writer, review schema changes and test live/export equivalence. |
| Core terminal/backend adapters | `portable-pty` 0.9, MIT; transitive `serial2`, BSD-2-Clause OR Apache-2.0 | Supported parent replaces unmaintained serial. NAC uses native PTYs, not serial ports. Retain the existing adapter rather than rewrite process ownership. Test Linux/macOS cleanup, EOF, signals, input/resize and backend command construction; keep remote coverage gaps explicit. |
| Core skill frontmatter | `serde-saphyr` 2 with only `deserialize`, MIT OR Apache-2.0 | Remove unmaintained unsafe-libyaml. The library and granit-parser forbid unsafe code; their transitive graph is not an all-safe-code guarantee. Preserve the existing raw parse, repair and retry, aliases, multiline strings and missing-field behavior. No include, interpolation, robotics, serialization or filesystem features. Reconsider if real compatibility fixtures fail. |
| Web development: Locator Alt-click/editor/clipboard workflow | Scoped `@locator/runtime -> tailwindcss 4.3.3` override, MIT | Locator 0.5.1 ships compiled styles but declares its Tailwind 3 build tool as a runtime dependency. That tree introduces braces (no patched release) and old selector-parser. Published runtime modules do not import those build tools. This narrowly reviewed packaging workaround does not assert Tailwind 3/4 API compatibility. Preserve JSX attributes, HMR and absolute file:line:column copying. Remove the override when a supported Locator release corrects its packaging. |
| Web Markdown math parsing | Scoped `micromark-extension-math -> katex 0.18.2` override, MIT | Latest remark-math and micromark math parents still require affected KaTeX 0.16. NAC renders with MathJax. Cross the minimum patched boundary without replacing syntax/rendering; verify Markdown and the public KaTeX HTML entrypoint. Remove the override when a parent supports a patched range. |
| Web presentation stylesheet build | Direct dev dependency `postcss-selector-parser` 7.1.7, MIT | `scripts/presentation-css.ts` already imports this package directly but relied on Locator's transitive copy. Declare the existing build requirement explicitly after removing that obsolete tree. Preserve escaped/nested selectors and stylesheet namespace boundaries. |

The first import already contained these dependency families; no original
selection comparison was found. Their present roles establish use, not the
original author's motive. The paste, serial and unsafe-libyaml advisories are
maintenance notices, not invented critical CVEs.

Primary evidence:

- [Utoipa Axum replacement](https://github.com/juhaku/utoipa/blob/utoipa-axum-0.3.0/utoipa-axum/CHANGELOG.md),
  [Swagger zip upgrade](https://github.com/juhaku/utoipa/releases/tag/utoipa-swagger-ui-10.0.2).
- [Published portable-pty manifest](https://github.com/wezterm/wezterm/blob/f8921727a11b9f8b073e8c24821d72fd41283500/pty/Cargo.toml).
- [Published serde-saphyr manifest and features](https://github.com/bourumir-wyngs/serde-saphyr/blob/e3a4566ef2692f6b9c906a103f6841441a1924ba/Cargo.toml).
  The closer-compatibility alternative `yaml_serde` retains maintained c2rust
  [libyaml-rs](https://github.com/yaml/libyaml-rs) unsafe code. A custom parser
  or PTY rewrite would add ownership and compatibility work.
- [Locator packaging](https://github.com/infi-pc/locatorjs/blob/master/packages/runtime/package.json),
  [unpatched braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
  [selector-parser fix](https://github.com/advisories/GHSA-rj75-hqrm-r3gf).
- [Micromark dependency range](https://github.com/micromark/micromark-extension-math/blob/3.1.0/package.json),
  [KaTeX fix](https://github.com/KaTeX/KaTeX/releases/tag/v0.18.2).

## Managed image

The managed image remains opt-in, linux/amd64, nonroot, with the same mounted
directories, tools, readiness and signal/persistence contracts.

- Use current stable Debian 13 Trixie slim, pinned to its amd64 manifest.
  Upgrade both build and runtime together to preserve dynamic linking. Bookworm
  had many vendor records without a supported fix. Trixie is a supported path,
  not a guarantee of zero findings; never drop tools, filter no-fix findings or
  weaken severity/unknown policy to clear the baseline.
- Keep Node 24.22.1; replace its npm 11.19.1 bundle with pinned npm 11.21.1,
  Artistic-2.0. This updates the affected bundled graph while preserving the
  existing npm major. npm 12 changes CLI/config, shrinkwrap and script defaults.
- Pin Go 1.27.3 (BSD-3-Clause) and uv 0.13.4 (MIT OR Apache-2.0), including
  upstream archive checksums. uv removes a compromised CA root.
- Use checksum-pinned upstream gh 2.103.0 (MIT), whose actual Linux binary
  embeds Go 1.27.3. Rebuild the existing Git LFS 3.8.0 release (MIT) using
  Go 1.27.3: the official Linux LFS binary still embeds Go 1.27.0. Verify the
  module checksum through Go's checksum database and the explicit pinned sum;
  retain its license, remove build caches, and keep system LFS filters outside
  the persistent HOME. The approved dependency-only build overlay in
  `docker/managed/git-lfs/go.mod` and `go.sum` selects x/net 0.60.0 and its
  required x/crypto 0.57.0, x/text 0.42.0, x/sys 0.48.0 and x/sync 0.23.0;
  these retain the Go Authors' BSD-3-Clause terms. Generate changes with Go
  tooling against the checksum-verified upstream release and build with
  `-mod=readonly`; never run floating `go get` in the image build. Application
  source remains at revision `aece9221f8c09221a14395d964806b956289bc07`.
  Remove the overlay when a supported upstream LFS release includes the fixed
  dependencies. No application-code fork or vendored implementation enters NAC.

Evidence: [Debian stable](https://www.debian.org/releases/),
[Go releases](https://go.dev/dl/),
[uv advisory](https://github.com/astral-sh/uv/security/advisories/GHSA-hq85-5cpj-mr62),
[npm 11.21.1](https://github.com/npm/cli/releases/tag/v11.21.1),
[gh release](https://github.com/cli/cli/releases/tag/v2.103.0),
[LFS release](https://github.com/git-lfs/git-lfs/releases/tag/v3.8.0).

The historical 508 blocking / 1,614 image finding records were pre-ALL-447 and
were not unique CVEs. Only a fresh exact-image inventory, scan and smoke can
establish this candidate's outcome. Remaining vendor no-fix records require a
new explicit decision; this change authorizes no exceptions or publication.

## Future dependency review

For a direct addition, replacement or material override, its owning subsystem
records purpose, owner, upstream/version, declared licenses, release/advisory
status, enabled features/platforms, alternatives, unsafe/native footprint and
behavioral verification. Prefer supported parent upgrades; reconsider stale
overrides when upstream releases change their dependency contract. Inspect the
complete resolved graph and lock diff, not just the named package.

Existing locked setup/builds, selective features, code ownership, architecture
and explicit import/license review remain effective. NAC's unsafe-block lint
does not audit third-party crates. Full source and exact-image gates detect
advisories; they do not prove maintainability, provenance or legal approval.
There is no new license allowlist or cargo-vet program in this change.
Update automation remains deferred to ALL-453.
