"""Synthetic custody negatives; no invented approval reaches GitHub or Docker."""

import hashlib
import io
import json
from pathlib import Path
import shutil
import stat
import subprocess
import tarfile
import tempfile
import unittest
import uuid
import warnings
import zipfile
from unittest.mock import patch

import image_candidate_archive as candidate
from image_approval_intake import ApprovalError


CONFIG = b'{"architecture":"amd64","os":"linux"}'
IMAGE = "sha256:" + hashlib.sha256(CONFIG).hexdigest()
SOURCE = "b" * 40


def image_archive(config=CONFIG):
    output = io.BytesIO()
    config_name = f"blobs/sha256/{IMAGE[7:]}"
    with tarfile.open(fileobj=output, mode="w") as tar:
        for name, payload in [("manifest.json", json.dumps([{"Config": config_name,
                "RepoTags": ["synthetic:local"], "Layers": []}]).encode()),
                              (config_name, config)]:
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            tar.addfile(info, io.BytesIO(payload))
    return output.getvalue()


def oci_image_archive(*, docker_config=CONFIG, selected_config=CONFIG,
                      platform="amd64", corrupt_descriptor=False, extra_platform=False):
    """One selected OCI image with an optional malicious identity seam."""
    def encoded(value):
        return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()

    docker_digest = hashlib.sha256(docker_config).hexdigest()
    selected_digest = hashlib.sha256(selected_config).hexdigest()
    manifest = encoded({"schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json",
                        "config": {"digest": f"sha256:{selected_digest}", "size": len(selected_config)},
                        "layers": []})
    manifest_digest = hashlib.sha256(manifest).hexdigest()
    children = [{"mediaType": "application/vnd.oci.image.manifest.v1+json",
                 "digest": f"sha256:{manifest_digest}", "size": len(manifest),
                 "platform": {"os": "linux", "architecture": platform}}]
    if extra_platform:
        children.append({**children[0], "platform": {"os": "linux", "architecture": "arm64"}})
    index = encoded({"schemaVersion": 2, "mediaType": "application/vnd.oci.image.index.v1+json",
                     "manifests": children})
    image = "sha256:" + hashlib.sha256(index).hexdigest()
    top = encoded({"schemaVersion": 2, "manifests": [{
        "mediaType": "application/vnd.oci.image.index.v1+json",
        "digest": image, "size": len(index)}]})
    blobs = {"manifest.json": encoded([{"Config": f"blobs/sha256/{docker_digest}",
                                         "RepoTags": ["synthetic:local"], "Layers": []}]),
             "index.json": top,
             f"blobs/sha256/{docker_digest}": docker_config,
             f"blobs/sha256/{manifest_digest}": manifest,
             f"blobs/sha256/{image[7:]}": index[:-1] + b" " if corrupt_descriptor else index}
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w") as tar:
        for name, payload in blobs.items():
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            tar.addfile(info, io.BytesIO(payload))
    return output.getvalue(), image


class CandidateArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.serial = 0
        self.members = {
            "image.tar": image_archive(),
            "inventory/identity.json": json.dumps({"image": IMAGE, "source_revision": SOURCE}).encode(),
            "inventory/sbom.syft.json": b'{"nonempty":"inventory"}',
        }
        self.members["inventory/bundle.json"] = json.dumps({
            "schema_version": 4, "image": IMAGE,
            "files": {"identity.json": "a" * 64, "sbom.syft.json": "b" * 64},
        }).encode()

    def archive(self, members=None):
        self.serial += 1
        output = self.root / f"artifact-{self.serial}.zip"
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as zipped:
            for name, payload in (members or self.members).items():
                zipped.writestr(name, payload)
        return output, "sha256:" + hashlib.sha256(output.read_bytes()).hexdigest()

    def extract(self, members=None, *, image=IMAGE, source=SOURCE, archive_digest=None):
        archive, actual = self.archive(members)
        return candidate.extract_candidate(
            archive, self.root / f"out-{self.serial}", artifact_digest=archive_digest or actual,
            image=image, source_revision=source)

    def test_nonempty_frozen_candidate_extracts_and_loaded_id_is_rechecked(self):
        image_tar, inventory = self.extract()
        self.assertEqual(image_tar.read_bytes(), self.members["image.tar"])
        self.assertTrue((inventory / "sbom.syft.json").is_file())
        calls = []

        def run(argv, **kwargs):
            calls.append(argv)
            if len(calls) == 1:
                return subprocess.CompletedProcess(argv, 1, "")
            return subprocess.CompletedProcess(argv, 0, json.dumps([{
                "Id": IMAGE, "Os": "linux", "Architecture": "amd64"}]))

        self.assertEqual(candidate.load_exact_image(image_tar, IMAGE, run=run), IMAGE)
        self.assertEqual(calls[0], ["docker", "image", "inspect", IMAGE])
        self.assertEqual(calls[1][:3], ["docker", "image", "load"])
        self.assertEqual(calls[2], ["docker", "image", "inspect", IMAGE])

    def test_wrong_archive_digest_and_reviewed_identity_fail(self):
        with self.assertRaisesRegex(ApprovalError, "digest changed"):
            self.extract(archive_digest="sha256:" + "0" * 64)
        for name, value in [("image", "sha256:" + "c" * 64), ("source", "d" * 40)]:
            with self.subTest(name=name), self.assertRaisesRegex(ApprovalError, "reviewed image/source"):
                self.extract(**{name: value})

    def test_path_escape_duplicate_and_symlink_fail(self):
        for bad in ["../escape", "/absolute", "inventory/../escape", "inventory\\escape"]:
            with self.subTest(bad=bad), self.assertRaisesRegex(ApprovalError, "member"):
                self.extract({**self.members, bad: b"evil"})
        archive = self.root / "artifact.zip"
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(archive, "w") as zipped:
                for name, value in self.members.items():
                    zipped.writestr(name, value)
                zipped.writestr("image.tar", b"second image")
        with self.assertRaisesRegex(ApprovalError, "duplicate"):
            candidate.extract_candidate(archive, self.root / "out", image=IMAGE,
                source_revision=SOURCE,
                artifact_digest="sha256:" + hashlib.sha256(archive.read_bytes()).hexdigest())
        linked = dict(self.members)
        info = zipfile.ZipInfo("inventory/evil")
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        linked[info] = b"/etc/passwd"
        with self.assertRaisesRegex(ApprovalError, "linked"):
            self.extract(linked)

    def test_missing_extra_and_oversized_members_fail(self):
        for members in [
            {name: value for name, value in self.members.items() if name != "image.tar"},
            {**self.members, "inventory/extra.json": b"{}"},
        ]:
            with self.assertRaises(ApprovalError):
                self.extract(members)
        with patch.object(candidate, "MAX_IMAGE_BYTES", 4):
            with self.assertRaisesRegex(ApprovalError, "oversized"):
                self.extract()

    def test_loaded_image_identity_and_platform_are_mandatory(self):
        image_tar, _ = self.extract()
        for detail in [
            {"Id": "sha256:" + "c" * 64, "Os": "linux", "Architecture": "amd64"},
            {"Id": IMAGE, "Os": "linux", "Architecture": "arm64"},
            {"Id": IMAGE, "Os": "windows", "Architecture": "amd64"},
        ]:
            calls = []

            def run(argv, **kwargs):
                calls.append(argv)
                return subprocess.CompletedProcess(argv, 1 if len(calls) == 1 else 0,
                                                   json.dumps([detail]))

            with self.subTest(detail=detail), self.assertRaisesRegex(ApprovalError, "differs"):
                candidate.load_exact_image(image_tar, IMAGE, run=run)

    def test_preexisting_image_cannot_mask_different_load(self):
        image_tar, _ = self.extract()
        with self.assertRaisesRegex(ApprovalError, "already present"):
            candidate.load_exact_image(image_tar, IMAGE, run=lambda argv, **kwargs:
                subprocess.CompletedProcess(argv, 0, "[]"))

    def test_saved_archive_config_must_match_before_docker_load(self):
        image_tar, _ = self.extract({**self.members, "image.tar": image_archive(b"different config")})
        with self.assertRaisesRegex(ApprovalError, "config bytes differ"):
            candidate.load_exact_image(image_tar, IMAGE, run=lambda *args, **kwargs:
                self.fail("Docker must not receive a mismatched archive"))

    def test_selected_oci_descriptor_chain_binds_docker_config_and_platform(self):
        archive, image = oci_image_archive()
        path = self.root / "selected.tar"
        path.write_bytes(archive)
        candidate._check_image_config(path, image)
        mutations = [
            (dict(selected_config=b'{"architecture":"amd64","os":"linux","swapped":true}'),
             "selected OCI manifest config differs"),
            (dict(corrupt_descriptor=True), "descriptor bytes differ"),
            (dict(platform="arm64"), "unverifiable extra platform"),
            (dict(extra_platform=True), "unverifiable extra platform"),
            (dict(docker_config=b'{"architecture":"arm64","os":"linux"}'),
             "config platform differs"),
        ]
        for index, (options, message) in enumerate(mutations):
            with self.subTest(options=options), self.assertRaisesRegex(ApprovalError, message):
                payload, approved = oci_image_archive(**options)
                path = self.root / f"mutated-{index}.tar"
                path.write_bytes(payload)
                candidate._check_image_config(path, approved)

    def test_real_docker_save_control_when_daemon_available(self):
        if not shutil.which("docker") or subprocess.run(
                ["docker", "info"], capture_output=True, timeout=15).returncode != 0:
            self.skipTest("Docker daemon unavailable")
        context = self.root / "docker-control"
        context.mkdir()
        (context / "Dockerfile").write_text("FROM scratch\nCOPY payload /payload\n")
        (context / "payload").write_text("frozen-image-archive-control\n")
        tag = f"nac-image-archive-control:{uuid.uuid4().hex}"
        try:
            subprocess.run(["docker", "build", "--platform", "linux/amd64", "--quiet",
                            "--tag", tag, str(context)], check=True, capture_output=True,
                           timeout=120)
            image = subprocess.check_output(["docker", "image", "inspect", "--format",
                                             "{{.Id}}", tag], text=True, timeout=30).strip()
            saved = self.root / "real-image.tar"
            subprocess.run(["docker", "image", "save", "--output", str(saved), tag],
                           check=True, capture_output=True, timeout=120)
            candidate._check_image_config(saved, image)
        finally:
            subprocess.run(["docker", "image", "rm", "--force", tag],
                           capture_output=True, timeout=30)


if __name__ == "__main__":
    unittest.main()
