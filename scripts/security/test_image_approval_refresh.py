"""Synthetic V4 derivative controls; no production approval or status write."""

import copy
import json
from pathlib import Path
import unittest

import image_approval_refresh as refresh
import image_scan
from image_inventory import sha256, write_json
import test_image_applicability_bundle as fixture_module


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture_module.ApplicabilityBundleTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown if hasattr(self.fixture, "tearDown") else lambda: None)
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.add_libssh2()
        inspected = self.fixture.inspected[0]
        inspected.update({"RepoTags": ["synthetic:old"],
                          "RepoDigests": ["synthetic@" + fixture_module.IMAGE],
                          "Metadata": {"LastTagTime": "2026-11-10T11:00:00Z"},
                          "RootFS": {"Type": "layers", "Layers": ["sha256:" + "1" * 64]},
                          "Identity": {"Build": [{"CreatedAt": "2026-11-10T11:00:00Z",
                                                  "Ref": "syntheticbuilder123"}]}})
        self.fixture.identity["inspected"] = copy.deepcopy(inspected)
        self.fixture.capture(schema_version=4)
        write_json(self.fixture.output / "identity.json", self.fixture.identity)
        for name in refresh.BASE_FILES:
            (self.fixture.output / name).write_bytes(b"{}")
        image_scan.bundle_manifest(self.fixture.output, fixture_module.IMAGE)
        self.original_bundle = sha256(self.fixture.output / "bundle.json")
        self.original_identity = sha256(self.fixture.output / "identity.json")
        self.verified = self.fixture.root / "verified"
        self.derivative = self.fixture.root / "derivative"

    def test_frozen_validation_and_fresh_derivative_keep_base_and_audit_hashes(self):
        identity = refresh.verify_frozen(self.fixture.output, self.verified,
            image=fixture_module.IMAGE, source_revision=fixture_module.SOURCE)
        self.fixture.inspected[0]["RepoTags"] = ["synthetic:new"]
        self.fixture.inspected[0]["RepoDigests"] = []
        self.fixture.inspected[0]["Metadata"]["LastTagTime"] = "2026-11-11T12:00:00Z"
        self.fixture.inspected[0]["Identity"] = None
        output = refresh.recollect(self.fixture.output, self.verified,
            self.derivative, identity, image=fixture_module.IMAGE,
            source_revision=fixture_module.SOURCE, command=self.fixture.docker,
            download=self.fixture.download)
        self.assertEqual(output, self.derivative)
        self.assertEqual(sha256(self.fixture.output / "bundle.json"), self.original_bundle)
        self.assertEqual(sha256(self.fixture.output / "identity.json"), self.original_identity)
        self.assertNotEqual(sha256(output / "identity.json"), self.original_identity)
        for name in refresh.BASE_FILES:
            self.assertEqual(sha256(output / name), sha256(self.fixture.output / name))
        receipt = json.loads((self.fixture.root / "refresh-receipt.json").read_bytes())
        self.assertEqual(receipt["frozen_bundle_sha256"], self.original_bundle)
        self.assertEqual(receipt["frozen_identity_sha256"], self.original_identity)
        self.assertEqual(receipt["derivative_bundle_sha256"], sha256(output / "bundle.json"))
        self.assertEqual(json.loads((output / "identity.json").read_bytes())["inspected"],
                         self.fixture.inspected[0])

    def test_changed_immutable_inspect_or_platform_fails_before_capture(self):
        identity = refresh.verify_frozen(self.fixture.output, self.verified,
            image=fixture_module.IMAGE, source_revision=fixture_module.SOURCE)
        for changed in ({"Config": {"Labels": {"org.opencontainers.image.revision": fixture_module.SOURCE},
                                     "Volumes": {"/new": {}}}},
                        {"Architecture": "arm64"},
                        {"Id": "sha256:" + "0" * 64},
                        {"RootFS": {"Type": "layers", "Layers": ["sha256:" + "2" * 64]}},
                        {"Identity": {"Build": [{"CreatedAt": "2026-11-10T11:00:00Z",
                                                   "Ref": "differentbuilder123"}]}}):
            with self.subTest(changed=changed):
                actual = copy.deepcopy(self.fixture.inspected[0])
                actual.update(changed)
                with self.assertRaises(ValueError):
                    refresh.bind_loaded_inspect(identity["inspected"], actual,
                        image=fixture_module.IMAGE,
                        source_revision=fixture_module.SOURCE)

    def test_docker_load_losing_exact_frozen_build_identity_is_bounded(self):
        frozen = copy.deepcopy(self.fixture.inspected[0])
        frozen["Identity"] = {"Build": [{"CreatedAt": "2026-11-12T03:59:55Z",
                                          "Ref": "mixdvcwee3qf0v8lflex4huvj"}]}
        loaded = copy.deepcopy(frozen)
        loaded["Identity"] = None
        self.assertEqual(refresh.bind_loaded_inspect(frozen, loaded,
            image=fixture_module.IMAGE, source_revision=fixture_module.SOURCE), loaded)
        del loaded["Identity"]
        self.assertEqual(refresh.bind_loaded_inspect(frozen, loaded,
            image=fixture_module.IMAGE, source_revision=fixture_module.SOURCE), loaded)
        without_origin = copy.deepcopy(frozen)
        without_origin["Identity"] = None
        with self.assertRaisesRegex(ValueError, "build identity is missing"):
            refresh.bind_loaded_inspect(without_origin, loaded,
                image=fixture_module.IMAGE, source_revision=fixture_module.SOURCE)

    def test_changed_frozen_v4_hash_fails_before_recollection(self):
        path = self.fixture.output / "applicability-context.json"
        path.write_bytes(path.read_bytes() + b" ")
        with self.assertRaisesRegex(ValueError, "retained evidence hash mismatch"):
            refresh.verify_frozen(self.fixture.output, self.verified,
                image=fixture_module.IMAGE, source_revision=fixture_module.SOURCE)

    def test_collection_failure_keeps_original_and_no_derivative_receipt(self):
        identity = refresh.verify_frozen(self.fixture.output, self.verified,
            image=fixture_module.IMAGE, source_revision=fixture_module.SOURCE)
        self.fixture.docker.fail = "create"
        with self.assertRaisesRegex(RuntimeError, "synthetic Docker failure"):
            refresh.recollect(self.fixture.output, self.verified,
                self.derivative, identity, image=fixture_module.IMAGE,
                source_revision=fixture_module.SOURCE, command=self.fixture.docker,
                download=self.fixture.download)
        self.assertEqual(sha256(self.fixture.output / "bundle.json"), self.original_bundle)
        self.assertFalse((self.fixture.root / "refresh-receipt.json").exists())


if __name__ == "__main__":
    unittest.main()
