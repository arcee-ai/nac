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

    def capture(self):
        clock = SimpleNamespace(datetime=SimpleNamespace(now=lambda timezone: NOW), timezone=dt.timezone)
        with patch.object(bundle, "dt", clock):
            return bundle.capture(self.identity, self.output, self.docker, self.download)

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


if __name__ == "__main__":
    unittest.main()
