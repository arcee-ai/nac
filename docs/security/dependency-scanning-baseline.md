# Source baseline: October 21, 2026

Candidate: `1c9ccccae2202a74ade42f20cad220f279a7dde8` (dev).
Scanned at 2026-10-21T20:59:22.118Z with checksum-verified OSV-Scanner 2.7.0.
All three inputs completed without scanner errors; 57 blocking advisory records,
zero exceptions. Aliased advisories can produce separate records; these are not
57 distinct CVEs. This snapshot is evidence, never a suppression or clean bill.

| Input | Packages | SHA-256 |
| --- | --- | --- |
| Cargo.lock | 405 | 0be8cdb1d2f4c768e4cc1459385217824820af7961fab3e82552f99c299dff7f |
| crates/nac-server/web/package-lock.json | 657 | 4a630555b544f555627a7e004499bea7fba6efb97cff668c0da2213520323a4b |
| .github/scripts/package-lock.json | 162 | 139124d4993f589cd63ad4f69cfcfb8d333a8f2c45cb1d82ce2fa8cdcaf09bf7 |

ALL-447 is Eric’s existing In Progress remediation. “Related” below means the
package is named in that ticket or belongs to its Vitest upgrade. It does not
assert that Eric’s proposed versions resolve every advisory: for example, the
fresh @vitest/mocker result includes a fix at 4.1.12 beyond the ticket’s 4.1.11.
“Residual” means no upgrade for that package is proposed there, including its
explicitly deferred zip, braces, KaTeX and selector-parser changes. No live
`fix/dependency-cves` remote branch or matching ALL-447 PR was found on this date.
Recheck ALL-447/live PRs before changing dependencies; do not duplicate its work.

| Input | Package | Installed | Advisory | Fixed versions | ALL-447 overlap |
| --- | --- | --- | --- | --- | --- |
| Cargo.lock | crates.io:paste | 1.0.15 | RUSTSEC-2024-0436 | none reported | Residual |
| Cargo.lock | crates.io:quinn-proto | 0.11.15 | RUSTSEC-2026-0338 | 0.11.18 | Related |
| Cargo.lock | crates.io:quinn-proto | 0.11.15 | RUSTSEC-2026-0339 | 0.11.17 | Related |
| Cargo.lock | crates.io:quinn-proto | 0.11.15 | RUSTSEC-2026-0340 | 0.11.18 | Related |
| Cargo.lock | crates.io:quinn-proto | 0.11.15 | RUSTSEC-2026-0341 | 0.11.17 | Related |
| Cargo.lock | crates.io:quinn-proto | 0.11.15 | RUSTSEC-2026-0342 | 0.11.17 | Related |
| Cargo.lock | crates.io:rustls | 0.23.41 | RUSTSEC-2026-0285 | 0.23.45 | Related |
| Cargo.lock | crates.io:rustls | 0.23.41 | RUSTSEC-2026-0346 | 0.23.46 | Related |
| Cargo.lock | crates.io:rustls | 0.23.41 | RUSTSEC-2026-0348 | 0.23.46 | Related |
| Cargo.lock | crates.io:rustls | 0.23.41 | RUSTSEC-2026-0349 | 0.23.46 | Related |
| Cargo.lock | crates.io:rustls | 0.23.41 | GHSA-2mjx-qc3c-rqvc | 0.23.45 | Related |
| Cargo.lock | crates.io:rustls-webpki | 0.103.13 | RUSTSEC-2026-0382 | 0.103.16, 0.104.0-alpha.8 | Related |
| Cargo.lock | crates.io:serial | 0.4.0 | RUSTSEC-2017-0008 | none reported | Residual |
| Cargo.lock | crates.io:unsafe-libyaml | 0.2.11 | RUSTSEC-2024-0449 | none reported | Residual |
| Cargo.lock | crates.io:webpki-root-certs | 1.0.8 | RUSTSEC-2026-0383 | 0.26.11, 1.0.10 | Related |
| Cargo.lock | crates.io:zip | 3.0.0 | RUSTSEC-2026-0367 | 9.0.0 | Residual |
| Cargo.lock | crates.io:zip | 3.0.0 | RUSTSEC-2026-0368 | 9.0.0 | Residual |
| Cargo.lock | crates.io:zip | 3.0.0 | RUSTSEC-2026-0369 | 9.0.0 | Residual |
| crates/nac-server/web/package-lock.json | npm:@vitest/mocker | 4.1.10 | GHSA-82fw-gwwq-j7x9 | 4.1.11, 5.0.0-rc.2 | Related |
| crates/nac-server/web/package-lock.json | npm:@vitest/mocker | 4.1.10 | GHSA-qxg6-89mg-rqv8 | 4.1.12, 5.0.3 | Related |
| crates/nac-server/web/package-lock.json | npm:@xmldom/xmldom | 0.9.10 | GHSA-27p8-2357-5qqv | 0.8.15, 0.9.12 | Related |
| crates/nac-server/web/package-lock.json | npm:@xmldom/xmldom | 0.9.10 | GHSA-3px3-54cx-rmw9 | 0.9.12 | Related |
| crates/nac-server/web/package-lock.json | npm:@xmldom/xmldom | 0.9.10 | GHSA-4w3w-2rp5-g8jm | 0.9.11, 0.8.14 | Related |
| crates/nac-server/web/package-lock.json | npm:@xmldom/xmldom | 0.9.10 | GHSA-6gmq-8vp8-gcm6 | 0.8.15, 0.9.12 | Related |
| crates/nac-server/web/package-lock.json | npm:@xmldom/xmldom | 0.9.10 | GHSA-6h8r-xr42-gp59 | 0.8.15, 0.9.12 | Related |
| crates/nac-server/web/package-lock.json | npm:@xmldom/xmldom | 0.9.10 | GHSA-6mj3-qw4j-hgrw | 0.9.12 | Related |
| crates/nac-server/web/package-lock.json | npm:@xmldom/xmldom | 0.9.10 | GHSA-8344-3jmq-59r6 | 0.8.15, 0.9.12 | Related |
| crates/nac-server/web/package-lock.json | npm:@xmldom/xmldom | 0.9.10 | GHSA-93r5-fhx6-vmg9 | 0.8.15, 0.9.12 | Related |
| crates/nac-server/web/package-lock.json | npm:@xmldom/xmldom | 0.9.10 | GHSA-965w-775f-mr7g | 0.8.15, 0.9.12 | Related |
| crates/nac-server/web/package-lock.json | npm:@xmldom/xmldom | 0.9.10 | GHSA-c7q8-3ch8-vqpv | 0.8.15, 0.9.12 | Related |
| crates/nac-server/web/package-lock.json | npm:@xmldom/xmldom | 0.9.10 | GHSA-g53g-w8rj-fmg7 | 0.9.11 | Related |
| crates/nac-server/web/package-lock.json | npm:@xmldom/xmldom | 0.9.10 | GHSA-vr34-hp96-76pp | 0.9.12 | Related |
| crates/nac-server/web/package-lock.json | npm:@xmldom/xmldom | 0.9.10 | GHSA-w2rr-34g9-rvrj | 0.9.11, 0.8.14 | Related |
| crates/nac-server/web/package-lock.json | npm:brace-expansion | 5.0.9 | GHSA-6j4f-fj2g-mc7p | 5.0.10, 3.0.7, 2.1.5, 1.1.19 | Related |
| crates/nac-server/web/package-lock.json | npm:brace-expansion | 5.0.9 | GHSA-q2hr-2g5m-vwhr | 5.0.12, 3.0.9, 2.1.7, 1.1.21 | Related |
| crates/nac-server/web/package-lock.json | npm:brace-expansion | 5.0.9 | GHSA-qhr7-859c-m2p7 | 5.0.11, 3.0.8, 2.1.6, 1.1.20 | Related |
| crates/nac-server/web/package-lock.json | npm:braces | 3.0.3 | GHSA-vfj7-8cjw-p6xm | none reported | Residual |
| crates/nac-server/web/package-lock.json | npm:katex | 0.16.47 | GHSA-238p-pmpm-9mq7 | 0.18.2 | Residual |
| crates/nac-server/web/package-lock.json | npm:postcss-selector-parser | 6.1.4 | GHSA-rj75-hqrm-r3gf | 7.1.6 | Residual |
| crates/nac-server/web/package-lock.json | npm:seroval | 1.5.6 | GHSA-jp82-f5mq-hwhp | 1.6.3 | Related |
| crates/nac-server/web/package-lock.json | npm:seroval | 1.5.6 | GHSA-p6vx-979v-rg4c | 1.6.2 | Related |
| crates/nac-server/web/package-lock.json | npm:source-map-js | 1.2.1 | GHSA-68fv-2mgg-jv7q | 1.2.2 | Residual |
| crates/nac-server/web/package-lock.json | npm:tinypool | 2.1.0 | GHSA-5gmw-xhrv-c9v3 | 2.1.1 | Related |
| crates/nac-server/web/package-lock.json | npm:tinypool | 2.1.0 | GHSA-85c8-ppgw-ccpr | 2.1.2 | Related |
| crates/nac-server/web/package-lock.json | npm:vite | 8.2.0 | GHSA-587h-7wmj-h5pm | 8.3.3, 8.2.4, 8.1.6, 7.3.7, 6.4.4 | Related |
| crates/nac-server/web/package-lock.json | npm:vite | 8.2.0 | GHSA-698v-4r3x-3vcv | 8.3.3, 8.2.4, 8.1.6, 7.3.7, 6.4.4 | Related |
| crates/nac-server/web/package-lock.json | npm:vite | 8.2.0 | GHSA-9jrq-w75r-8gcw | 8.3.3, 8.2.4, 8.1.6, 7.3.7, 6.4.4 | Related |
| crates/nac-server/web/package-lock.json | npm:vite | 8.2.0 | GHSA-r825-w8mm-5pxw | 8.3.3, 8.2.4, 8.1.6, 7.3.7, 6.4.4 | Related |
| crates/nac-server/web/package-lock.json | npm:vite | 8.2.0 | GHSA-rq7h-c2jc-7f22 | 8.3.3, 8.2.4, 8.1.6, 7.3.7, 6.4.4 | Related |
| crates/nac-server/web/package-lock.json | npm:vite | 8.2.0 | GHSA-vfpm-58rq-9qcg | 8.3.3, 8.2.4 | Related |
| crates/nac-server/web/package-lock.json | npm:vitest | 4.1.10 | GHSA-82fw-gwwq-j7x9 | 4.1.11, 5.0.0-rc.2 | Related |
| .github/scripts/package-lock.json | npm:brace-expansion | 5.0.9 | GHSA-6j4f-fj2g-mc7p | 5.0.10, 3.0.7, 2.1.5, 1.1.19 | Related |
| .github/scripts/package-lock.json | npm:brace-expansion | 5.0.9 | GHSA-q2hr-2g5m-vwhr | 5.0.12, 3.0.9, 2.1.7, 1.1.21 | Related |
| .github/scripts/package-lock.json | npm:brace-expansion | 5.0.9 | GHSA-qhr7-859c-m2p7 | 5.0.11, 3.0.8, 2.1.6, 1.1.20 | Related |
| .github/scripts/package-lock.json | npm:handlebars | 4.7.9 | GHSA-8r5x-fm3f-whwj | 4.7.10 | Related |
| .github/scripts/package-lock.json | npm:handlebars | 4.7.9 | GHSA-p8wg-vrv2-v86f | 4.7.10 | Related |
| .github/scripts/package-lock.json | npm:handlebars | 4.7.9 | GHSA-xw65-4hp5-5hc7 | 4.7.10 | Related |

No baseline exception is approved. Preserve this failed result while preparing
the tooling. Before production activation, refresh the complete graph after
reviewed remediation, or obtain separately reviewed exact expiring exceptions.
Ordinary merge blocking, scheduled deployed execution and prepublication failure
qualification remain rollout acceptance work; local fixtures do not prove them.
