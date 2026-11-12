"""Synthetic tar/Docker-boundary controls; no image execution or disposition."""
import copy
import datetime as dt
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import image_applicability_bundle as bundle
import image_applicability_evidence as collector
from image_applicability import verify_applicability
from test_image_applicability_evidence import archive, elf

IMAGE, SOURCE, CONTAINER = "sha256:" + "a" * 64, "b" * 40, "c" * 64
NOW = dt.datetime(2026, 11, 10, 12, tzinfo=dt.timezone.utc)


class DockerBoundary:
    def __init__(self, fixture):
        self.fixture, self.calls, self.fail = fixture, [], None

    def __call__(self, args, **kwargs):
        self.calls.append((args, kwargs))
        operation = args[1]
        if operation == self.fail:
            raise RuntimeError("synthetic Docker failure: " + operation)
        if operation == "create":
            return CONTAINER + "\n"
        if operation == "image":
            return json.dumps(self.fixture.inspected)
        if operation == "container":
            return json.dumps(self.fixture.container)
        if operation == "export":
            shutil.copyfile(self.fixture.archive, args[args.index("--output") + 1])
            return ""
        if operation == "rm":
            return CONTAINER
        raise AssertionError("unexpected Docker operation")


class ApplicabilityBundleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.output = self.root / "bundle"
        self.output.mkdir()
        self.archive = self.root / "fixture.tar"
        self.pins = {"schema_version": 1, "downloads": {}}
        self.payloads, self.tree = {}, {"runtime/underlying": b"retained under declared VOLUME"}
        for owner in ("curl", "krb5"):
            names = [owner + ".tar.gz", owner + ".patch"]
            for name in names:
                data = ("reviewed fixture " + name).encode()
                url = "https://example.invalid/" + name
                self.payloads[url] = data
                self.pins["downloads"][name] = {"url": url, "sha256": hashlib.sha256(data).hexdigest()}
            self.pins[owner] = {"version": "1.2.3", "package_version": "1.2.3-r6", "source_commit": "d" * 40,
                "archive": names[0], "patches": names[1:], "license": "MIT", "upstream_name": owner}
        for installed, owner in collector.PACKAGES.items():
            path, data = "usr/lib/" + installed + ".so.1", elf()
            self.tree[path] = data
            record = {"schema_version": 1, "supplier": "NAC", "package": installed,
                **self.pins[owner], "downloads": self.pins["downloads"],
                "installed_payload": {"/" + path: {"sha256": hashlib.sha256(data).hexdigest()}}}
            self.tree["usr/share/nac/package-provenance/" + installed + ".json"] = collector.canonical_json(record)
        self.tree["usr/share/nac/runtime-package-build/sources.lock.json"] = collector.canonical_json(self.pins)
        archive(self.archive, self.tree)
        self.inspected = [{"Id": IMAGE, "Os": "linux", "Architecture": "amd64", "Config": {
            "Labels": {"org.opencontainers.image.revision": SOURCE}, "Volumes": {"/runtime": {}}}}]
        self.container = [{"Id": CONTAINER, "Image": IMAGE, "Config": {"Image": IMAGE},
            "State": {"Status": "created", "Running": False, "StartedAt": "0001-01-01T00:00:00Z"},
            "RestartCount": 0, "HostConfig": {"NetworkMode": "none", "ReadonlyRootfs": True,
                "Binds": None, "Mounts": [], "Tmpfs": {}, "VolumesFrom": []},
            "Mounts": [{"Type": "volume", "Name": "e" * 64, "Destination": "/runtime"}]}]
        self.identity = {"image": IMAGE, "source_revision": SOURCE, "inspected": copy.deepcopy(self.inspected[0]),
                         "runtime_package_pins": self.pins}
        self.docker = DockerBoundary(self)
        self.downloads = []

    def download(self, url, *, limit):
        self.downloads.append((url, limit))
        return self.payloads[url]

    def capture(self, schema_version=3):
        clock = SimpleNamespace(datetime=SimpleNamespace(now=lambda timezone: NOW), timezone=dt.timezone)
        with patch.object(bundle, "dt", clock):
            return bundle.capture(self.identity, self.output, self.docker, self.download, schema_version=schema_version)

    def add_libssh2(self):
        names = ["libssh2.tar.gz", "libssh2-debian.tar.xz", "libssh2-supplier-55200.patch", "libssh2-supplier-sftp.patch"]
        for name in names:
            data, url = ("reviewed fixture " + name).encode(), "https://example.invalid/" + name
            self.payloads[url] = data
            self.pins["downloads"][name] = {"url": url, "sha256": hashlib.sha256(data).hexdigest()}
        fixes = []
        for name in sorted(collector.LIBSSH2_LOCAL_PATCHES):
            data = ("benign local correction " + name).encode()
            self.tree["usr/share/nac/runtime-package-build/" + name] = data
            fixes.append({"patch": name, "sha256": hashlib.sha256(data).hexdigest()})
        self.pins["libssh2"] = {"version": "1.11.1", "package_version": "1.11.1-r12", "source_commit": "f" * 40,
            "archive": names[0], "patches": names[1:], "license": "BSD-3-Clause", "upstream_name": "libssh2",
            "downstream_fixes": fixes}
        payload = elf("libcrypto.so.4")
        self.tree["usr/lib/libssh2.so.1"] = payload
        for name, data in list(self.tree.items()):
            if name.startswith("usr/share/nac/package-provenance/"):
                record = json.loads(data)
                record["downloads"] = self.pins["downloads"]
                self.tree[name] = collector.canonical_json(record)
        self.tree["usr/share/nac/package-provenance/libssh2.json"] = collector.canonical_json({
            "schema_version": 1, "supplier": "NAC", "package": "libssh2", **self.pins["libssh2"],
            "downloads": self.pins["downloads"],
            "installed_payload": {"/usr/lib/libssh2.so.1": {"sha256": hashlib.sha256(payload).hexdigest()}}})
        self.tree["usr/share/nac/runtime-package-build/sources.lock.json"] = collector.canonical_json(self.pins)
        archive(self.archive, self.tree)

    def rewrite(self, name, value):
        (self.output / name).write_bytes(collector.canonical_json(value))

    def test_complete_capture_retains_exact_binary_sources_profiles_and_owned_cleanup(self):
        (self.output / "base-input.json").write_text("untouched base bundle")
        retained = self.capture()
        self.assertEqual(retained, bundle.files(self.identity))
        self.assertEqual(set(p.name for p in self.output.iterdir()), retained | {"base-input.json"})
        self.assertEqual((self.output / "base-input.json").read_text(), "untouched base bundle")
        self.assertEqual((self.output / bundle.ARCHIVE).read_bytes(), self.archive.read_bytes())
        self.assertEqual(self.docker.calls[0], (["docker", "create", "--platform", "linux/amd64",
            "--network", "none", "--read-only", IMAGE], {}))
        self.assertEqual(self.docker.calls[-1], (["docker", "rm", "-v", CONTAINER], {}))
        export = next(call for call in self.docker.calls if call[0][1] == "export")
        self.assertEqual(export[0], ["docker", "export", "--output", str(self.output / bundle.ARCHIVE), CONTAINER])
        self.assertEqual(export[1], {"timeout": 1800})
        self.assertTrue(all(call[0][1] not in {"start", "run", "exec"} for call in self.docker.calls))
        self.assertEqual({limit for _, limit in self.downloads}, {bundle.MAX_SOURCE_BYTES})
        filesystem = json.loads((self.output / bundle.PROFILES["filesystem"]).read_text())
        self.assertIn("/runtime/underlying", filesystem["entries"])
        self.assertIn("/usr/lib/krb5-libs.so.1", filesystem["entries"])

    def test_rescan_recollects_full_tar_without_docker_network_or_a_fresh_clock(self):
        self.capture()
        with patch.object(collector, "collect_evidence", wraps=collector.collect_evidence) as recollect:
            observations = bundle.validate(self.output, self.identity)
        self.assertEqual(recollect.call_count, 1)
        self.assertEqual(recollect.call_args.args, (self.output / bundle.ARCHIVE,))
        self.assertEqual(len(observations), 9)
        self.assertEqual({item["observed_at"] for item in observations}, {"2026-11-10T12:00:00Z"})
        for installed, coordinates in bundle.COORDINATES.items():
            found = [item["binding"] for item in observations if item["binding"]["installed_package"] == "apk:" + installed]
            self.assertEqual({item["package"] for item in found}, set(coordinates))
        self.assertTrue(all("libssh2" not in str(item) for item in observations))
        self.assertEqual(len(self.downloads), 4)
        self.assertEqual(self.docker.calls[-1][0], ["docker", "rm", "-v", CONTAINER])

    def test_stale_original_clock_is_preserved_and_verifier_rejects_it(self):
        self.capture()
        observations = bundle.validate(self.output, self.identity)
        raw = b'{"schema_version":1,"rules":[]}'
        with self.assertRaisesRegex(ValueError, "stale/future observation"):
            verify_applicability([], trusted_policy=raw, candidate_policy=raw, evidence={}, observations=observations,
                scan_identity={"image": IMAGE, "source_revision": SOURCE, "platform": "linux/amd64"},
                now=NOW + dt.timedelta(days=2))

    def test_changed_tar_with_rehashed_context_cannot_validate_unchanged_json_profiles(self):
        self.capture()
        self.tree["usr/bin/new-consumer"] = elf("libgssapi_krb5.so.2")
        archive(self.output / bundle.ARCHIVE, self.tree)
        context = json.loads((self.output / bundle.CONTEXT).read_text())
        context["archive_sha256"] = bundle.sha256(self.output / bundle.ARCHIVE)
        self.rewrite(bundle.CONTEXT, context)
        with self.assertRaisesRegex(ValueError, "changed/incomplete passive"):
            bundle.validate(self.output, self.identity)

    def test_every_retained_input_is_required_and_changed_profiles_sources_inspect_fail(self):
        self.capture()
        for name in sorted(bundle.files(self.identity)):
            path, original = self.output / name, (self.output / name).read_bytes()
            path.unlink()
            with self.subTest(missing=name), self.assertRaises(ValueError):
                bundle.validate(self.output, self.identity)
            path.write_bytes(original)
            path.write_bytes(b"{}\n")
            with self.subTest(changed=name), self.assertRaises(ValueError):
                bundle.validate(self.output, self.identity)
            path.write_bytes(original)

    def test_independent_image_source_platform_pins_or_container_bindings_cannot_drift(self):
        self.capture()
        for field, value in [("image", "sha256:" + "f" * 64), ("source_revision", "f" * 40)]:
            identity = {**self.identity, field: value}
            with self.subTest(field=field), self.assertRaises(ValueError):
                bundle.validate(self.output, identity)
        identity = copy.deepcopy(self.identity)
        identity["runtime_package_pins"]["curl"]["version"] = "9.9.9"
        with self.assertRaisesRegex(ValueError, "source lock differs"):
            bundle.validate(self.output, identity)
        for field, value in [("NetworkMode", "host"), ("ReadonlyRootfs", False)]:
            container = copy.deepcopy(self.container)
            container[0]["HostConfig"][field] = value
            self.rewrite(bundle.CONTAINER_INSPECT, container)
            context = json.loads((self.output / bundle.CONTEXT).read_text())
            context["container_inspect_sha256"] = bundle.sha256(self.output / bundle.CONTAINER_INSPECT)
            self.rewrite(bundle.CONTEXT, context)
            with self.subTest(field=field), self.assertRaises(ValueError):
                bundle.validate(self.output, self.identity)

    def test_export_inspection_and_size_failures_cleanup_only_owned_container(self):
        for operation in ("image", "container", "export"):
            self.docker = DockerBoundary(self)
            self.docker.fail = operation
            with self.subTest(operation=operation), self.assertRaises(RuntimeError):
                self.capture()
            self.assertEqual(self.docker.calls[-1][0], ["docker", "rm", "-v", CONTAINER])
        self.docker = DockerBoundary(self)
        with patch.object(bundle, "MAX_ARCHIVE_BYTES", 1024), self.assertRaisesRegex(ValueError, "oversized"):
            self.capture()
        self.assertEqual(self.docker.calls[-1][0], ["docker", "rm", "-v", CONTAINER])

    def test_cleanup_failure_is_not_success_and_create_failure_has_no_unknown_cleanup(self):
        self.docker.fail = "rm"
        with self.assertRaisesRegex(RuntimeError, "rm"):
            self.capture()
        self.assertFalse((self.output / bundle.CONTEXT).exists())
        self.output = self.root / "second-bundle"
        self.output.mkdir()
        self.docker = DockerBoundary(self)
        self.docker.fail = "create"
        with self.assertRaisesRegex(RuntimeError, "create"):
            self.capture()
        self.assertEqual(len(self.docker.calls), 1)

    def test_mismatched_download_never_produces_context(self):
        self.payloads[next(iter(self.payloads))] = b"changed pinned bytes"
        with self.assertRaisesRegex(ValueError, "source download mismatch"):
            self.capture()
        self.assertFalse((self.output / bundle.CONTEXT).exists())
        self.assertEqual(self.docker.calls[-1][0], ["docker", "rm", "-v", CONTAINER])

    def test_started_wrong_platform_or_mounted_containers_fail_before_export_with_cleanup(self):
        original = copy.deepcopy(self.container)
        cases = []
        for field, value in (("Status", "exited"), ("Running", True), ("StartedAt", "2026-11-10T01:00:00Z")):
            value_inspect = copy.deepcopy(original)
            value_inspect[0]["State"][field] = value
            cases.append(value_inspect)
        value_inspect = copy.deepcopy(original)
        value_inspect[0]["HostConfig"]["Binds"] = ["/host:/runtime"]
        cases.append(value_inspect)
        value_inspect = copy.deepcopy(original)
        value_inspect[0]["Mounts"] = []
        cases.append(value_inspect)
        for container in cases:
            self.container, self.docker = container, DockerBoundary(self)
            with self.subTest(container=container), self.assertRaises(ValueError):
                self.capture()
            self.assertNotIn("export", [call[0][1] for call in self.docker.calls])
            self.assertEqual(self.docker.calls[-1][0], ["docker", "rm", "-v", CONTAINER])
        self.container, self.docker = original, DockerBoundary(self)
        self.inspected[0]["Architecture"] = "arm64"
        with self.assertRaisesRegex(ValueError, "inspection changed"):
            self.capture()
        self.assertEqual(self.docker.calls[-1][0], ["docker", "rm", "-v", CONTAINER])

    def test_unsafe_source_names_shapes_urls_and_existing_outputs_fail_before_docker(self):
        cases = []
        for name in ("../escape", "/absolute", "a/b", "a\\b", ".hidden", "name\x00"):
            pins = copy.deepcopy(self.pins)
            pins["downloads"][name] = pins["downloads"].pop("curl.tar.gz")
            pins["curl"]["archive"] = name
            cases.append(pins)
        for mutation in ("missing", "hash", "url", "duplicate", "schema"):
            pins = copy.deepcopy(self.pins)
            if mutation == "missing": pins.pop("krb5")
            elif mutation == "hash": pins["downloads"]["curl.patch"]["sha256"] = "bad"
            elif mutation == "url": pins["downloads"]["curl.patch"]["url"] = "https://user:secret@example.invalid/x"
            elif mutation == "duplicate": pins["curl"]["patches"] *= 2
            else: pins["schema_version"] = True
            cases.append(pins)
        for pins in cases:
            with self.subTest(pins=pins), self.assertRaises(ValueError):
                bundle.capture({**self.identity, "runtime_package_pins": pins}, self.output, self.docker, self.download)
        self.assertEqual(self.docker.calls, [])
        (self.output / bundle.ARCHIVE).symlink_to(self.archive)
        with self.assertRaisesRegex(ValueError, "output already exists"):
            self.capture()
        self.assertEqual(self.docker.calls, [])

    def test_complete_v3_bundle_rescan_and_report_preserve_raw_rows_and_match_only_reviewed_fixture(self):
        import image_scan as scan
        import image_ci_report as reporter
        import image_applicability_gate as gate
        from image_inventory import write_json, sha256
        from image_rust import RUST_FILES
        from test_image_applicability import fixture, encode

        self.capture()
        # Full bundle boundaries use real synthetic export/profile collection;
        # opaque base scanner inputs are retained, not claimed as a native scan.
        for name, value in {"identity.json": self.identity, "runtime.json": {"synthetic": True},
                            "sbom.syft.json": {"synthetic": True}, "coverage.json": {"synthetic": True},
                            **{name: {"synthetic": True} for name in RUST_FILES}}.items():
            write_json(self.output / name, value)
        scan.bundle_manifest(self.output, IMAGE)
        manifest = json.loads((self.output / "bundle.json").read_text())
        self.assertEqual(manifest["schema_version"], 3)
        retained = self.root / "rescan"
        retained.mkdir()
        original_read = Path.read_bytes
        def bounded_read(path):
            self.assertNotEqual(path.name, bundle.ARCHIVE, "full retained image tar allocation")
            return original_read(path)
        with patch.object(Path, "read_bytes", bounded_read):
            self.assertEqual(scan.load_bundle(self.output, retained), self.identity)
        scan.bundle_manifest(retained, IMAGE)
        observations = bundle.validate(retained, self.identity)
        actual_binding = observations[0]["binding"]
        f = fixture()
        f["record"]["binding"] = actual_binding
        f["record"]["collected_at"] = "2026-11-10T12:00:00Z"
        rule = f["rules"][0]
        rule["binding"] = actual_binding
        rule["finding"].update(package=actual_binding["package"], version=actual_binding["package_version"])
        rule["review"].update(reviewed_at="2026-11-10T12:01:00Z", expires_at="2026-11-11T12:01:00Z")
        record = encode(f["record"])
        rule["evidence_sha256"] = hashlib.sha256(record).hexdigest()
        policy = encode({"schema_version": 1, "rules": [rule]})
        trusted, candidate = self.root / "trusted-policy.json", self.root / "candidate-policy.json"
        reviewed = self.root / "external-reviewed-image.json"
        trusted.write_bytes(encode({"schema_version": 1, "rules": []}))
        candidate.write_bytes(trusted.read_bytes())
        reviewed.write_bytes(policy)
        proofs = self.root / "proofs"
        proofs.mkdir()
        for digest, raw in {**f["evidence"], rule["evidence_sha256"]: record}.items():
            (proofs / digest).write_bytes(raw)
        finding = {**f["findings"][0], "package": actual_binding["package"], "version": actual_binding["package_version"]}
        findings = [finding, {**finding, "advisory": "CVE-UNREVIEWED-SYNTHETIC"}]
        raw_bytes = (json.dumps(findings, separators=(",", ":")) + "\n").encode()
        (retained / "findings.json").write_bytes(raw_bytes)
        source = {"blocking": findings, "excepted": [], "reporting": []}
        write_json(retained / "policy-result.json", source)
        receipt = gate.evaluate(findings, trusted_path=trusted, candidate_path=candidate,
            reviewed_path=reviewed, reviewed_sha256=hashlib.sha256(policy).hexdigest(),
            evidence_directory=proofs, observations=observations,
            scan_identity={"image": IMAGE, "source_revision": SOURCE, "platform": "linux/amd64"},
            now=NOW + dt.timedelta(minutes=2))
        self.assertEqual(receipt["approval_mode"], "post-build")
        self.assertEqual(receipt["policy_sha256"], hashlib.sha256(policy).hexdigest())
        self.assertEqual(receipt["candidate_policy_sha256"], hashlib.sha256(candidate.read_bytes()).hexdigest())
        decision = gate.retain_decision(retained, source, receipt, self.identity)
        self.assertEqual(decision["blocking_indexes"], [1])
        write_json(retained / "result.json", {"status": "blocked", "image": IMAGE,
            "blocking": 1, "findings": 2, "applicability": "verified",
            "decision_sha256": sha256(retained / "decision.json")})
        (retained / "report.md").write_text("Synthetic review-bound disposition; not production evidence.\n")
        self.assertEqual(reporter.report(retained, 1)["blocking"], 1)
        self.assertEqual((retained / "findings.json").read_bytes(), raw_bytes)
        self.assertEqual(json.loads((retained / "policy-result.json").read_bytes()), source)
        # The same complete retained rescan can bind a shared curl coordinate
        # only when both independently observed APK payloads are reviewed.
        from test_image_applicability import aggregate_fixture
        shared = aggregate_fixture()
        curl_bindings = sorted((copy.deepcopy(item["binding"]) for item in observations
                                if item["binding"]["package"] == "upstream-wolfi:curl"),
                               key=lambda item: item["installed_package"])
        self.assertEqual([item["installed_package"] for item in curl_bindings],
                         ["apk:curl", "apk:libcurl-openssl4"])
        aggregate_rule = shared["rules"][0]
        aggregate_rule["bindings"] = curl_bindings
        aggregate_rule["finding"]["version"] = curl_bindings[0]["upstream_version"]
        aggregate_rule["review"].update(reviewed_at="2026-11-10T12:01:00Z",
                                        expires_at="2026-11-11T12:01:00Z")
        shared["record"].update(bindings=copy.deepcopy(curl_bindings),
                                collected_at="2026-11-10T12:00:00Z")
        aggregate_record = encode(shared["record"])
        aggregate_rule["evidence_sha256"] = hashlib.sha256(aggregate_record).hexdigest()
        shared_finding = {**finding, "package": "upstream-wolfi:curl",
                          "version": curl_bindings[0]["upstream_version"]}
        aggregate_evidence = {**shared["evidence"], aggregate_rule["evidence_sha256"]: aggregate_record}
        aggregate_policy = encode({"schema_version": 2, "rules": [aggregate_rule]})
        aggregate_receipt = verify_applicability([shared_finding],
            trusted_policy=trusted.read_bytes(), candidate_policy=candidate.read_bytes(),
            reviewed_image_approval=aggregate_policy, evidence=aggregate_evidence,
            observations=observations, scan_identity={"image": IMAGE, "source_revision": SOURCE,
                                                       "platform": "linux/amd64"},
            now=NOW + dt.timedelta(minutes=2))
        self.assertEqual(aggregate_receipt["unresolved_indexes"], [])
        changed = copy.deepcopy(observations)
        next(item for item in changed if item["binding"]["installed_package"] ==
             "apk:libcurl-openssl4" and item["binding"]["package"] ==
             "upstream-wolfi:curl")["binding"]["payload_sha256"] = "d" * 64
        with self.assertRaisesRegex(ValueError, "independently verified observation"):
            verify_applicability([shared_finding], trusted_policy=trusted.read_bytes(),
                candidate_policy=candidate.read_bytes(), reviewed_image_approval=aggregate_policy,
                evidence=aggregate_evidence, observations=changed,
                scan_identity={"image": IMAGE, "source_revision": SOURCE, "platform": "linux/amd64"},
                now=NOW + dt.timedelta(minutes=2))
        (self.output / bundle.ARCHIVE).write_bytes(b"tampered")
        corrupt = self.root / "corrupt-rescan"
        corrupt.mkdir()
        with self.assertRaisesRegex(ValueError, "retained evidence hash mismatch"):
            scan.load_bundle(self.output, corrupt)

    def test_bundle_loading_rejects_same_byte_source_symlinks_before_normalizing_them(self):
        import image_scan as scan
        from image_inventory import write_json
        from image_rust import RUST_FILES

        self.capture()
        for name in ("runtime.json", "sbom.syft.json", "coverage.json", *RUST_FILES):
            write_json(self.output / name, {"synthetic": True})
        write_json(self.output / "identity.json", self.identity)
        scan.bundle_manifest(self.output, IMAGE)
        name = next(iter(bundle.source_files(self.identity).values()))
        original = self.output / name
        external = self.root / "external-source"
        original.rename(external)
        original.symlink_to(external)
        output = self.root / "symlink-rescan"
        output.mkdir()
        with self.assertRaises(OSError):
            scan.load_bundle(self.output, output)
        self.assertFalse((output / name).exists())

    def test_v4_adds_exact_libssh2_bindings_without_changing_legacy_observations(self):
        self.add_libssh2()
        self.capture(3)
        legacy = bundle.validate(self.output, self.identity)
        original = {name: (self.output / name).read_bytes() for name in bundle.files(self.identity, 3)}
        self.output = self.root / "v4"
        self.output.mkdir()
        retained = self.capture(4)
        self.assertEqual(retained, bundle.files(self.identity, 4))
        self.assertEqual(bundle.version(self.output), 4)
        observed = bundle.validate(self.output, self.identity)
        self.assertEqual(observed[:9], legacy)
        self.assertEqual(len(observed), 12)
        self.assertEqual({item["binding"]["package"] for item in observed[9:]}, set(bundle.LIBSSH2_COORDINATES))
        self.assertEqual({item["binding"]["installed_package"] for item in observed[9:]}, {"apk:libssh2"})
        self.assertEqual({item["observed_at"] for item in observed}, {"2026-11-10T12:00:00Z"})
        provenance = bundle.read_json(self.output, bundle.PROFILES["provenance"])
        self.assertEqual(provenance["profile"], collector.LIBSSH2_PROFILE)
        patches = {name: self.pins["downloads"][name]["sha256"] for name in self.pins["libssh2"]["patches"]}
        patches.update(collector.local_patches(self.pins))
        self.assertEqual(provenance["packages"]["libssh2"]["patches_sha256"], collector.digest(patches))
        for item in observed[9:]:
            self.assertEqual(item["binding"]["upstream_version"], "1.11.1")
            self.assertEqual(item["binding"]["package_version"], "1.11.1-r12")
        # Existing V3 bytes remain replayable even when the image already owns libssh2.
        old = self.root / "old-v3"
        old.mkdir()
        for name, data in original.items():
            (old / name).write_bytes(data)
        self.assertEqual(bundle.version(old), 3)
        self.assertEqual(bundle.validate(old, self.identity), legacy)

    def test_v4_remote_and_local_patch_bytes_and_payload_are_required(self):
        self.add_libssh2()
        self.capture(4)
        for name in set(bundle.source_files(self.identity, 4).values()) - set(bundle.source_files(self.identity, 3).values()):
            path = self.output / name
            original = path.read_bytes()
            for changed in (None, b"tampered"):
                path.unlink()
                if changed is not None:
                    path.write_bytes(changed)
                with self.subTest(source=name, changed=changed), self.assertRaises(ValueError):
                    bundle.validate(self.output, self.identity)
                if path.exists():
                    path.unlink()
                path.write_bytes(original)
            outside = self.root / name
            path.rename(outside)
            path.symlink_to(outside)
            with self.assertRaises(ValueError):
                bundle.validate(self.output, self.identity)
            path.unlink()
            outside.rename(path)
        for path in [*("usr/share/nac/runtime-package-build/" + name for name in collector.LIBSSH2_LOCAL_PATCHES),
                     "usr/lib/libssh2.so.1", "usr/share/nac/package-provenance/libssh2.json"]:
            original = self.tree[path]
            for changed in (None, b"{}"):
                self.tree.pop(path)
                if changed is not None:
                    self.tree[path] = changed
                archive(self.output / bundle.ARCHIVE, self.tree)
                context = bundle.read_json(self.output, bundle.CONTEXT)
                context["archive_sha256"] = bundle.sha256(self.output / bundle.ARCHIVE)
                self.rewrite(bundle.CONTEXT, context)
                with self.subTest(path=path, changed=changed), self.assertRaises(ValueError):
                    bundle.validate(self.output, self.identity)
                self.tree[path] = original
        for kind in ("links", "hardlinks"):
            path = "usr/share/nac/runtime-package-build/libssh2-list-followups.patch"
            data = self.tree.pop(path)
            self.tree["usr/share/nac/runtime-package-build/same-bytes"] = data
            archive(self.output / bundle.ARCHIVE, self.tree, **{kind: {path: "usr/share/nac/runtime-package-build/same-bytes"}})
            context = bundle.read_json(self.output, bundle.CONTEXT)
            context["archive_sha256"] = bundle.sha256(self.output / bundle.ARCHIVE)
            self.rewrite(bundle.CONTEXT, context)
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, "local patch bytes"):
                bundle.validate(self.output, self.identity)
            self.tree[path] = data
            del self.tree["usr/share/nac/runtime-package-build/same-bytes"]

    def test_v4_local_pin_shapes_and_source_limits_fail_closed(self):
        self.add_libssh2()
        original = copy.deepcopy(self.pins["libssh2"]["downstream_fixes"])
        for fixes in ([], original[:1], original * 2,
                      [{**original[0], "patch": "../escape"}, original[1]],
                      [{**original[0], "sha256": "bad"}, original[1]]):
            self.pins["libssh2"]["downstream_fixes"] = fixes
            with self.subTest(fixes=fixes), self.assertRaisesRegex(ValueError, "local patch pins"):
                self.capture(4)
        self.assertEqual(self.docker.calls, [])
        self.pins["libssh2"]["downstream_fixes"] = original
        path = self.root / "source"
        path.write_bytes(b"bounded original source")
        link = self.root / "source-link"
        link.symlink_to(path)
        with self.assertRaises(OSError):
            collector.source_digest(link)
        metadata = path.stat()
        for size in (150 * 1024 ** 2 + 1, metadata.st_size - 1, metadata.st_size + 1):
            changed = SimpleNamespace(st_mode=metadata.st_mode, st_size=size)
            with self.subTest(size=size), patch.object(collector.os, "fstat", return_value=changed), self.assertRaises(ValueError):
                collector.source_digest(path)
        with path.open("rb") as source:
            self.assertEqual(collector.source_digest(path), hashlib.sha256(source.read()).hexdigest())

    def test_v4_scan_bundle_load_and_report_keep_all_raw_blockers(self):
        import image_scan as scan
        import image_ci_report as reporter
        import image_applicability_gate as gate
        from image_inventory import write_json, sha256
        from image_rust import RUST_FILES

        self.add_libssh2()
        self.capture(4)
        for name in ("runtime.json", "sbom.syft.json", "coverage.json", *RUST_FILES):
            write_json(self.output / name, {"synthetic": True})
        write_json(self.output / "identity.json", self.identity)
        scan.bundle_manifest(self.output, IMAGE)
        self.assertEqual(json.loads((self.output / "bundle.json").read_text())["schema_version"], 4)
        capped = self.root / "v4-capped"
        capped.mkdir()
        with patch.object(bundle, "MAX_SOURCE_BYTES", 1), self.assertRaisesRegex(ValueError, "oversized retained evidence"):
            scan.load_bundle(self.output, capped)
        retained = self.root / "v4-rescan"
        retained.mkdir()
        original_read = Path.read_bytes
        def bounded_read(path):
            self.assertNotEqual(path.name, bundle.ARCHIVE, "full retained image tar allocation")
            return original_read(path)
        with patch.object(Path, "read_bytes", bounded_read):
            self.assertEqual(scan.load_bundle(self.output, retained), self.identity)
        scan.bundle_manifest(retained, IMAGE)
        observations = bundle.validate(retained, self.identity)
        findings = [{"package": coordinate, "advisory": "CVE-SYNTHETIC-UNQUALIFIED", "version": "1.11.1",
                     "severity": "High", "source": "synthetic", "context": "managed-image"}
                    for coordinate in bundle.LIBSSH2_COORDINATES]
        source = {"blocking": findings, "excepted": [], "reporting": []}
        policy = self.root / "empty-policy.json"
        policy.write_text('{"schema_version":1,"rules":[]}')
        receipt = gate.evaluate(findings, trusted_path=policy, candidate_path=policy, evidence_directory=None,
            observations=observations, scan_identity={"image": IMAGE, "source_revision": SOURCE, "platform": "linux/amd64"}, now=NOW)
        write_json(retained / "findings.json", findings)
        raw = (retained / "findings.json").read_bytes()
        write_json(retained / "policy-result.json", source)
        decision = gate.retain_decision(retained, source, receipt, self.identity)
        self.assertEqual(decision["blocking_indexes"], [0, 1, 2])
        write_json(retained / "result.json", {"status": "blocked", "image": IMAGE, "blocking": 3, "findings": 3,
            "applicability": receipt["status"], "decision_sha256": sha256(retained / "decision.json")})
        (retained / "report.md").write_text("Synthetic passive evidence; no security qualification.\n")
        self.assertEqual(reporter.report(retained, 1)["blocking"], 3)
        self.assertEqual((retained / "findings.json").read_bytes(), raw)
        self.assertEqual(json.loads((retained / "policy-result.json").read_text()), source)
        # A separate review of this frozen V4 image can admit only the named
        # synthetic coordinate on a later unchanged-image rescan.
        from test_image_applicability import fixture, encode
        approved = self.root / "v4-post-build"
        approved.mkdir()
        self.assertEqual(scan.load_bundle(self.output, approved), self.identity)
        scan.bundle_manifest(approved, IMAGE)
        approved_observations = bundle.validate(approved, self.identity)
        selected = next(item for item in approved_observations
                        if item["binding"]["package"] == findings[0]["package"])
        f = fixture()
        f["record"].update(binding=selected["binding"], collected_at="2026-11-10T12:00:00Z")
        rule = f["rules"][0]
        rule["binding"] = selected["binding"]
        rule["finding"] = {"package": findings[0]["package"], "version": findings[0]["version"],
                           "source": findings[0]["source"], "advisories": [findings[0]["advisory"]]}
        rule["review"].update(reviewed_at="2026-11-10T12:00:00Z",
                              expires_at="2026-11-11T12:00:00Z")
        record = encode(f["record"])
        rule["evidence_sha256"] = hashlib.sha256(record).hexdigest()
        external_policy = self.root / "v4-external-reviewed.json"
        external_policy.write_bytes(encode({"schema_version": 1, "rules": [rule]}))
        proofs = self.root / "v4-external-proofs"
        proofs.mkdir()
        for digest, data in {**f["evidence"], rule["evidence_sha256"]: record}.items():
            (proofs / digest).write_bytes(data)
        approved_receipt = gate.evaluate(findings, trusted_path=policy, candidate_path=policy,
            reviewed_path=external_policy, reviewed_sha256=sha256(external_policy),
            evidence_directory=proofs, observations=approved_observations,
            scan_identity={"image": IMAGE, "source_revision": SOURCE, "platform": "linux/amd64"},
            now=NOW + dt.timedelta(minutes=2))
        write_json(approved / "findings.json", findings)
        write_json(approved / "policy-result.json", source)
        approved_decision = gate.retain_decision(approved, source, approved_receipt, self.identity)
        self.assertEqual(approved_decision["blocking_indexes"], [1, 2])
        self.assertEqual((approved / "findings.json").read_bytes(), raw)
        self.assertEqual(approved_receipt["approval_mode"], "post-build")
        changed = copy.deepcopy(approved_observations)
        selected_index = next(index for index, item in enumerate(changed)
                              if item["binding"]["package"] == findings[0]["package"])
        changed[selected_index]["binding"]["payload_sha256"] = "d" * 64
        with self.assertRaises(ValueError):
            gate.evaluate(findings, trusted_path=policy, candidate_path=policy,
                reviewed_path=external_policy, reviewed_sha256=sha256(external_policy),
                evidence_directory=proofs, observations=changed,
                scan_identity={"image": IMAGE, "source_revision": SOURCE, "platform": "linux/amd64"},
                now=NOW + dt.timedelta(minutes=2))
        manifest = json.loads((self.output / "bundle.json").read_text())
        manifest["schema_version"] = 3
        write_json(self.output / "bundle.json", manifest)
        downgraded = self.root / "downgraded"
        downgraded.mkdir()
        with self.assertRaisesRegex(ValueError, "incomplete bundle"):
            scan.load_bundle(self.output, downgraded)
        for name in bundle.files(self.identity, 4) - bundle.files(self.identity, 3):
            del manifest["files"][name]
        write_json(self.output / "bundle.json", manifest)
        disguised = self.root / "disguised-v3"
        disguised.mkdir()
        with self.assertRaisesRegex(ValueError, "capability differs"):
            scan.load_bundle(self.output, disguised)
        write_json(retained / "bundle.json", manifest)
        with self.assertRaisesRegex(ValueError, "capability differs"):
            reporter.report(retained, 1)


if __name__ == "__main__":
    unittest.main()
