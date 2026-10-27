"""Installed component/pin/payload and public advisory fail-closed contracts."""
import copy
import datetime as dt
from email.utils import format_datetime
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

import image_rust as rust
import image_rust_advisories as advisories
import image_scan as scan
from image_inventory import write_json
from rust_test_support import rust_fixture, add_rust_bundle

NOW = dt.datetime(2026, 10, 27, 12, tzinfo=dt.timezone.utc)


def record(repo="cargo", name="cargo", affected="<= 0.72.1", severity="high"):
    return {"ghsa_id": "GHSA-j3xp-wfr4-hx87", "state": "published", "severity": severity,
        "html_url": f"https://github.com/rust-lang/{repo}/security/advisories/GHSA-j3xp-wfr4-hx87",
        "published_at": "2023-08-01T00:00:00Z", "updated_at": "2023-08-01T00:00:00Z", "withdrawn_at": None,
        "description": "Prose claims 1.71.1 fixed. Machine metadata must remain authoritative.",
        "vulnerabilities": [{"package": {"ecosystem": "rust", "name": name},
                              "vulnerable_version_range": affected, "patched_versions": "0.72.2"}]}


class RustInventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.pins, self.raw = rust_fixture(self.root)

    def test_manifest_source_and_binary_identities_are_distinct(self):
        result = rust.rust_inventory(self.raw, self.pins, self.root)
        self.assertEqual(result["distribution"], "1.98.0")
        self.assertEqual(result["components"]["cargo"]["version"], "0.99.0")
        self.assertEqual(result["components"]["rustfmt-preview"]["version"], "1.9.0")
        self.assertEqual(result["components"]["clippy-preview"]["version"], "0.1.98")

    def test_missing_components_wrong_target_and_unexpected_toolchain_fail(self):
        for field, value in (("targets", "aarch64-unknown-linux-gnu"), ("components", "rustc"),
                             ("active", "stable (default)"), ("toolchains", []), ("payload", {})):
            with self.subTest(field=field), self.assertRaises(ValueError):
                rust.rust_inventory(dict(self.raw, **{field: value}), self.pins, self.root)
        for pins in (None, {}, dict(self.pins, manifest_sha256="0" * 64)):
            with self.subTest(pins=pins), self.assertRaises(ValueError):
                rust.rust_inventory(self.raw, pins, self.root)

    def test_proxy_path_hash_and_actual_payload_changes_fail(self):
        for name in self.raw["proxies"]:
            for field, value in (("sha256", "d" * 64), ("resolved", "/tmp/rustup"), ("path", "/tmp/proxy")):
                broken = copy.deepcopy(self.raw)
                broken["proxies"][name][field] = value
                with self.subTest(name=name, field=field), self.assertRaises(ValueError):
                    rust.rust_inventory(broken, self.pins, self.root)
        for field in ("payload", "which", "versions"):
            broken = copy.deepcopy(self.raw)
            key = next(iter(broken[field]))
            broken[field][key] = "altered"
            with self.subTest(field=field), self.assertRaises(ValueError):
                rust.rust_inventory(broken, self.pins, self.root)
        broken = copy.deepcopy(self.raw)
        broken["payload"]["bin/unexpected"] = {"sha256": "e" * 64}
        with self.assertRaisesRegex(ValueError, "unexpected Rust payload"):
            rust.rust_inventory(broken, self.pins, self.root)

    def test_immutable_manifest_or_payload_metadata_tamper_fails(self):
        for file in ("rust-distribution.toml", "rust-payload.json"):
            original = (self.root / file).read_bytes()
            (self.root / file).write_bytes(original + b" ")
            with self.subTest(file=file), self.assertRaises(ValueError):
                rust.rust_inventory(self.raw, self.pins, self.root)
            (self.root / file).write_bytes(original)

    def test_source_pin_parser_requires_unique_supported_version_and_installer_hash(self):
        source = Path("docker/managed/Dockerfile").read_text()
        pins = rust.source_rust_pins(source)
        self.assertEqual(pins["manifest_sha256"], rust.MANIFEST_PINS[pins["RUST_VERSION"]])
        for text in ("", source + "\nARG RUST_VERSION=1.98.0\n", source.replace("ARG RUST_VERSION=1.98.0", "ARG RUST_VERSION=1.99.0"),
                     source.replace("ARG RUSTUP_SHA256=", "ARG ABSENT=")):
            with self.subTest(text=text[:30]), self.assertRaises(ValueError):
                rust.source_rust_pins(text)

    def test_old_bundle_requires_reinventory_before_scan(self):
        write_json(self.root / "bundle.json", {"schema_version": 1, "image": "sha256:" + "a" * 64, "files": {}})
        with self.assertRaisesRegex(ValueError, "reinventory"):
            scan.load_bundle(self.root, self.root)

    def test_archive_payload_is_read_without_extraction_and_rejects_unsafe_entries(self):
        for path in ("bin/cargo", "../escape"):
            buf = io.BytesIO()
            with tarfile.open(fileobj=buf, mode="w:xz") as archive:
                for name, data in (("cargo/manifest.in", f"file:{path}\n".encode()), ("cargo/" + path, b"binary")):
                    info = tarfile.TarInfo("release/" + name)
                    info.size = len(data)
                    archive.addfile(info, io.BytesIO(data))
            if path.startswith(".."):
                with self.assertRaises(ValueError):
                    rust.archive_payload(buf.getvalue(), "cargo")
            else:
                self.assertEqual(rust.archive_payload(buf.getvalue(), "cargo"), {path: {"sha256": rust.digest(b"binary")}})


class RustAdvisoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        pins, raw = rust_fixture(self.root)
        self.coverage = rust.rust_inventory(raw, pins, self.root)

    def test_cargo_binary_and_source_ranges_and_contradiction_remain_conservative(self):
        source = record()
        binary = record(affected=">= 1.60.0, < 1.72")
        binary["ghsa_id"] = "GHSA-wrrj-h57r-vx9p"
        binary["html_url"] = binary["html_url"].replace("GHSA-j3xp-wfr4-hx87", binary["ghsa_id"])
        binary["vulnerabilities"][0]["patched_versions"] = "1.72"
        # These source identities are fixed observations; live qualification checks official manifests.
        for version, source_version, expected in (("1.71.0", "0.72.0", 2), ("1.71.1", "0.72.1", 2),
                                                   ("1.72.0", "0.73.0", 0), ("1.98.0", "0.99.0", 0)):
            coverage = copy.deepcopy(self.coverage)
            coverage["distribution"] = version
            coverage["components"]["cargo"]["version"] = source_version
            normalized, findings = advisories.advisory_records("cargo", [source, binary], coverage)
            self.assertEqual(len(findings), expected)
            if findings:
                self.assertEqual({f["identity_namespace"] for f in findings}, {"source", "distribution"})
            self.assertEqual(len(normalized), 2)

    def test_std_known_vulnerable_fixed_unknown_severity_and_withdrawn(self):
        item = record("rust", "std", "<= 1.58.0", None)
        item["vulnerabilities"][0]["patched_versions"] = "1.58.1"
        for version, expected in (("1.58.0", 1), ("1.58.1", 0)):
            coverage = copy.deepcopy(self.coverage)
            coverage["components"]["rust-std"]["version"] = version
            normal, found = advisories.advisory_records("rust", [item], coverage)
            self.assertEqual(len(found), expected)
            if found:
                self.assertEqual(found[0]["severity"], "Unknown")
            item["withdrawn_at"] = "2023-08-02T00:00:00Z"
            normal, found = advisories.advisory_records("rust", [item], coverage)
            self.assertEqual(found, [])
            self.assertEqual(normal[0]["disposition"], "withdrawn")
            item["withdrawn_at"] = None

    def test_unsupported_mixed_ranges_or_identity_or_schema_never_clear(self):
        for expression in ("*", "^1.72", ">= 0.72, < 1.72", "< 1.72-beta", "", ">= 2.0.0", "<= 1.72", ">= 1.72.0, < 1.71.0"):
            with self.subTest(expression=expression), self.assertRaises(ValueError):
                advisories.advisory_records("cargo", [record(affected=expression)], self.coverage)
        for key, value in (("vulnerabilities", []), ("severity", "none"), ("published_at", None), ("state", "draft")):
            item = record();item[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                advisories.advisory_records("cargo", [item], self.coverage)
        with self.assertRaises(ValueError):
            advisories.advisory_records("cargo", [record(name="unrelated")], self.coverage)
        self.assertTrue(advisories.in_bounds((1, 71, 0), advisories.parse_range(">= 1.60.0, < 1.72 || = 1.98.0")[0]))

    def test_complete_empty_feeds_retain_raw_queries_with_hashes(self):
        calls = []
        def fetch(url):
            calls.append(url)
            return b"[]", {"http_status": 200, "content-type": "application/json", "date": format_datetime(NOW)}
        found = advisories.query_rust(self.coverage, self.root, fetch=fetch, now=NOW)
        self.assertEqual(found, [])
        evidence = json.loads((self.root / "rust-advisories.json").read_text())
        self.assertEqual(len(calls), 5)
        self.assertTrue(evidence["complete"])
        self.assertEqual(len(evidence["queries"]), 5)
        for query in evidence["queries"]:
            self.assertEqual(rust.digest((self.root / query["file"]).read_bytes()), query["sha256"])

    def test_multiple_complete_pages_are_evaluated_and_duplicates_fail(self):
        alphabet = "23456789cfghjmpqrvwx"
        items = []
        for i in range(101):
            item = record("rust", "std", "< 1.58.0")
            ghsa = "GHSA-2222-2222-22" + alphabet[i // len(alphabet)] + alphabet[i % len(alphabet)]
            item["ghsa_id"] = ghsa
            item["html_url"] = f"https://github.com/rust-lang/rust/security/advisories/{ghsa}"
            item["vulnerabilities"][0]["patched_versions"] = "1.58.0"
            items.append(item)
        calls = []
        def fetch(url):
            calls.append(url)
            headers = {"http_status": 200, "content-type": "application/json", "date": format_datetime(NOW)}
            if "/rust/" not in url:
                values = []
            elif url.endswith("page=1"):
                values = items[:100]
                headers["link"] = '<' + url[:-1] + '2>; rel="next", <' + url[:-1] + '2>; rel="last"'
            else:
                values = items[100:]
            return json.dumps(values).encode(), headers
        self.assertEqual(advisories.query_rust(self.coverage, self.root, fetch=fetch, now=NOW), [])
        self.assertEqual(len(calls), 6)
        evidence = json.loads((self.root / "rust-advisories.json").read_text())
        self.assertEqual(len(evidence["records"]), 101)
        with self.assertRaisesRegex(ValueError, "duplicate"):
            advisories.advisory_records("rust", [items[0], items[0]], self.coverage)

    def test_pagination_malformed_stale_failed_or_truncated_feeds_fail(self):
        headers = {"http_status": 200, "content-type": "application/json", "date": format_datetime(NOW)}
        for raw, extra in ((b'{}', {}), (b'[]', {"http_status": 403}), (b'[', {}), (b'[]', {"date": format_datetime(NOW - dt.timedelta(days=2))}),
                           (b'[]', {"link": '<https://evil.test/>; rel="next"'}),
                           (json.dumps([record()] * 100).encode(), {}),
                           (b'[]', {"link": '<https://api.github.com/repos/rust-lang/rust/security-advisories?per_page=100&page=2>; rel="next"'})):
            with self.subTest(raw=raw[:10], extra=extra), self.assertRaises((ValueError, TypeError)):
                advisories.query_rust(self.coverage, self.root,
                    fetch=lambda url: (raw, dict(headers, **extra)), now=NOW)
        def unavailable(url):
            raise OSError("rate limit/network unavailable")
        with self.assertRaises(OSError):
            advisories.query_rust(self.coverage, self.root, fetch=unavailable, now=NOW)
        self.assertFalse((self.root / "rust-advisories.json").exists())
        self.assertFalse(json.loads((self.root / "rust-advisory-error.json").read_text())["complete"])


if __name__ == "__main__":
    unittest.main()
