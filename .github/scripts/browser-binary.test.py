"""Real CLI controls for exact-run browser binary transport and partial retries."""

import copy
import gzip
import hashlib
import io
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("browser-binary.py")
SOURCE = "a" * 40
BASE = {
    "source": SOURCE, "repository": "arcee-ai/nac", "run-id": "123456",
    "attempt": "1", "target": "x86_64-unknown-linux-gnu",
    "rustc": "rustc 1.98.0 (88d9e12ae 2026-08-18)",
    "runner-image": "ubuntu24@20261101.1",
}


class BrowserBinaryCliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.binary = self.root / "fixture-binary"
        self.binary.write_bytes(b"#!/bin/sh\nprintf 'fixture binary\\n'\n")
        self.binary.chmod(0o755)
        self.packed = self.root / "packed"
        self.output = self.root / "consumed"
        result = self.cli("pack", "--binary", self.binary, "--output-dir", self.packed)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.produced = json.loads(result.stdout)
        self.receipt = self.produced["receipt"]
        self.archive = Path(self.produced["archive"])

    def cli(self, command, *args, identity=None, receipt=None, raw_receipt=None,
            optimized=False, **kwargs):
        options = {**BASE, **(identity or {})}
        flags = [item for name, value in options.items() for item in (f"--{name}", str(value))]
        env = {**os.environ, "BROWSER_BINARY_RECEIPT": raw_receipt if raw_receipt is not None
               else json.dumps(receipt if receipt is not None else getattr(self, "receipt", {}))}
        argv = [sys.executable] + (["-O"] if optimized else []) + [str(SCRIPT), command]
        return subprocess.run(argv + list(map(str, args)) + flags,
                              capture_output=True, text=True, env=env, timeout=10, **kwargs)

    def consume(self, **kwargs):
        return self.cli("consume", "--archive", self.archive, "--output-dir", self.output, **kwargs)

    def reject(self, **kwargs):
        result = self.consume(**kwargs)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertFalse(self.output.exists(), result.stderr)
        return result

    def mutate_receipt(self, change):
        value = copy.deepcopy(self.receipt)
        change(value)
        return value

    def members(self):
        with tarfile.open(self.archive, "r:gz") as tar:
            return [(entry, tar.extractfile(entry).read() if entry.isfile() else b"") for entry in tar]

    def rewrite(self, members):
        with tarfile.open(self.archive, "w:gz", format=tarfile.USTAR_FORMAT) as tar:
            for entry, data in members:
                tar.addfile(entry, io.BytesIO(data) if entry.isfile() else None)
        self.receipt["archive_bytes"] = self.archive.stat().st_size
        self.receipt["archive_sha256"] = hashlib.sha256(self.archive.read_bytes()).hexdigest()

    def rewrite_manifest(self, change):
        members = self.members()
        value = json.loads(members[0][1])
        change(value)
        data = json.dumps(value, separators=(",", ":")).encode()
        members[0][0].size = len(data)
        members[0] = (members[0][0], data)
        self.receipt["manifest_bytes"] = len(data)
        self.receipt["manifest_sha256"] = hashlib.sha256(data).hexdigest()
        self.rewrite(members)

    def test_current_attempt_transfers_exact_bytes_and_executable_mode(self):
        result = self.consume()
        self.assertEqual(result.returncode, 0, result.stderr)
        accepted = json.loads(result.stdout)
        self.assertEqual(accepted["mode"], "artifact")
        binary = Path(accepted["binary"])
        self.assertEqual(binary.read_bytes(), self.binary.read_bytes())
        self.assertEqual(binary.stat().st_mode & 0o777, 0o755)
        self.assertEqual(accepted["binary_sha256"], self.receipt["binary_sha256"])

    def test_multi_chunk_non_aligned_binary_streams_exactly(self):
        self.binary.write_bytes(b"x" * (3 * 1024 * 1024 + 513))
        result = self.cli("pack", "--binary", self.binary, "--output-dir", self.root / "large-pack")
        self.assertEqual(result.returncode, 0, result.stderr)
        produced = json.loads(result.stdout)
        result = self.cli("consume", "--archive", produced["archive"], "--output-dir", self.output,
                          receipt=produced["receipt"])
        self.assertEqual(result.returncode, 0, result.stderr)
        accepted = Path(json.loads(result.stdout)["binary"])
        self.assertEqual(accepted.stat().st_size, self.binary.stat().st_size)
        self.assertEqual(hashlib.sha256(accepted.read_bytes()).hexdigest(), produced["receipt"]["binary_sha256"])

    def test_github_outputs_are_bounded_single_lines(self):
        output = self.root / "github-output"
        result = self.cli("pack", "--binary", self.binary, "--output-dir", self.root / "other",
                          "--github-output", output)
        self.assertEqual(result.returncode, 0, result.stderr)
        fields = dict(line.split("=", 1) for line in output.read_text().splitlines())
        self.assertEqual(json.loads(fields["receipt"])["source_revision"], SOURCE)
        self.assertEqual(len(fields), 3)

    def test_wrong_source_repository_run_target_compiler_and_image(self):
        for field, wrong in {
            "source": "b" * 40, "repository": "other/repo", "run-id": "999",
            "target": "aarch64-apple-darwin", "rustc": "rustc 1.99.0 (different)",
            "runner-image": "ubuntu-other",
        }.items():
            with self.subTest(field=field):
                self.reject(identity={field: wrong})

    def test_malformed_expected_context(self):
        for change in ({"source": "not-a-sha"}, {"run-id": "001"}, {"attempt": "0"},
                       {"runner-image": "@"}, {"runner-image": "ubuntu24@"},
                       {"runner-image": "@20261101.1"}):
            with self.subTest(change=change):
                self.reject(identity=change)

    def test_missing_and_unknown_receipt_fields(self):
        missing = self.mutate_receipt(lambda value: value.pop("archive_sha256"))
        extra = {**self.receipt, "quality_passed": True}
        self.reject(receipt=missing)
        self.reject(receipt=extra)

    def test_duplicate_json_fields_and_non_object_receipt(self):
        raw = json.dumps(self.receipt)
        self.reject(raw_receipt=raw[:-1] + ',"run_id":"123456"}')
        self.reject(raw_receipt="[]")
        self.reject(raw_receipt="not JSON")
        self.reject(raw_receipt=json.dumps({**self.receipt, "binary_bytes": float("nan")}))

    def test_oversized_receipt(self):
        self.reject(raw_receipt=" " * 4097)

    def test_profile_track_build_id_and_schema_must_match(self):
        for field, wrong in {"dev_debug": 2, "profile": "release", "build_track": "stable",
                             "build_id": "some-other-build", "schema": True}.items():
            with self.subTest(field=field):
                self.reject(receipt={**self.receipt, field: wrong})

    def test_invalid_digest_and_size_types(self):
        for field, wrong in (("binary_bytes", True), ("archive_bytes", 0), ("manifest_bytes", 4097),
                             ("binary_sha256", "not-a-digest"), ("archive_bytes", 1.0),
                             ("binary_bytes", 513 * 1024 * 1024), ("archive_bytes", 514 * 1024 * 1024)):
            with self.subTest(field=field):
                self.reject(receipt={**self.receipt, field: wrong})

    def test_future_and_boolean_attempts(self):
        self.reject(receipt={**self.receipt, "run_attempt": 2})
        self.reject(receipt={**self.receipt, "run_attempt": True})

    def test_valid_older_attempt_selects_fresh_source_and_exposes_no_old_binary(self):
        result = self.consume(identity={"attempt": "2"})
        self.assertEqual(result.returncode, 0, result.stderr)
        accepted = json.loads(result.stdout)
        self.assertEqual(accepted, {"mode": "source", "binary": "", "binary_sha256": "", "producer_attempt": 1})
        self.assertFalse(self.output.exists())

    def test_image_rollout_between_attempts_still_builds_current_source(self):
        result = self.consume(identity={"attempt": "2", "runner-image": "ubuntu24@new-image"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["mode"], "source")
        self.assertFalse(self.output.exists())

    def test_old_attempt_malformed_or_foreign_receipt_still_fails(self):
        self.reject(identity={"attempt": "2"}, receipt={**self.receipt, "run_id": "999"})
        self.reject(identity={"attempt": "2"}, receipt={**self.receipt, "binary_sha256": "wrong"})

    def test_missing_artifact_fails_in_current_and_older_attempts(self):
        self.archive.unlink()
        self.reject()
        self.reject(identity={"attempt": "2"})

    def test_corrupt_artifact_fails_in_current_and_older_attempts(self):
        data = self.archive.read_bytes()
        self.archive.write_bytes(data[:-1] + bytes([data[-1] ^ 1]))
        self.reject()
        self.reject(identity={"attempt": "2"})

    def test_truncated_gzip_with_rebound_digest_fails(self):
        self.archive.write_bytes(self.archive.read_bytes()[:-8])
        self.receipt.update(archive_bytes=self.archive.stat().st_size,
                            archive_sha256=hashlib.sha256(self.archive.read_bytes()).hexdigest())
        self.reject()

    def test_wrong_manifest_digest(self):
        self.reject(receipt={**self.receipt, "manifest_sha256": "f" * 64})

    def test_foreign_manifest_even_with_valid_transport_digests(self):
        self.rewrite_manifest(lambda value: value.update(source_revision="b" * 40))
        self.reject()
        self.reject(identity={"attempt": "2"})

    def test_changed_manifest_binary_hash_is_not_self_attesting(self):
        self.rewrite_manifest(lambda value: value["binary"].update(sha256="f" * 64))
        self.reject()

    def test_corrupt_binary_payload_even_with_valid_archive_digest(self):
        members = self.members()
        members[1] = (members[1][0], b"x" * len(members[1][1]))
        self.rewrite(members)
        self.reject()
        self.reject(identity={"attempt": "2"})

    def test_manifest_missing_or_duplicate_fields(self):
        self.rewrite_manifest(lambda value: value.pop("target"))
        self.reject()

    def test_missing_duplicate_reordered_and_extra_members(self):
        original = self.members()
        for changed in (original[:1], [original[0], original[0]], list(reversed(original)),
                        original + [original[1]]):
            with self.subTest(names=[entry.name for entry, _ in changed]):
                self.rewrite(changed)
                self.reject()

    def test_archive_path_traversal_absolute_path_and_symlinks_fail(self):
        original = self.members()
        for name, kind in (("../outside", tarfile.REGTYPE), ("/outside", tarfile.REGTYPE),
                           ("nac-web", tarfile.SYMTYPE), ("nac-web", tarfile.LNKTYPE),
                           ("nac-web", tarfile.DIRTYPE), ("nac-web", tarfile.FIFOTYPE)):
            with self.subTest(name=name, kind=kind):
                changed = copy.deepcopy(original)
                changed[1][0].name, changed[1][0].type = name, kind
                if kind != tarfile.REGTYPE:
                    changed[1][0].size, changed[1][0].linkname = 0, "outside"
                self.rewrite(changed)
                self.reject()

    def test_oversized_member_and_privileged_mode_fail(self):
        original = self.members()
        for field, wrong in (("size", 513 * 1024 * 1024), ("mode", 0o4755)):
            with self.subTest(field=field):
                changed = copy.deepcopy(original)
                setattr(changed[1][0], field, wrong)
                # Write the header directly for an intentionally oversized declaration.
                payload = changed[0][0].tobuf(format=tarfile.USTAR_FORMAT) + changed[0][1]
                payload += b"\0" * ((-len(changed[0][1])) % 512)
                payload += changed[1][0].tobuf(format=tarfile.USTAR_FORMAT)
                self.archive.write_bytes(gzip.compress(payload))
                self.receipt.update(archive_bytes=self.archive.stat().st_size,
                                    archive_sha256=hashlib.sha256(self.archive.read_bytes()).hexdigest())
                self.reject()

    def test_nonzero_tar_padding_and_trailer_fail(self):
        original = gzip.decompress(self.archive.read_bytes())
        padding_offset = 512 + self.receipt["manifest_bytes"]
        binary_end = 512 + ((self.receipt["manifest_bytes"] + 511) // 512) * 512 + 512
        binary_end += ((self.receipt["binary_bytes"] + 511) // 512) * 512
        for offset in (padding_offset, binary_end, len(original) - 1):
            with self.subTest(offset=offset):
                data = bytearray(original)
                data[offset] = 1
                self.archive.write_bytes(gzip.compress(data))
                self.receipt.update(archive_bytes=self.archive.stat().st_size,
                                    archive_sha256=hashlib.sha256(self.archive.read_bytes()).hexdigest())
                self.reject()

    def test_decompression_is_bounded(self):
        raw = gzip.decompress(self.archive.read_bytes()) + b"\0" * 65536
        self.archive.write_bytes(gzip.compress(raw))
        self.receipt.update(archive_bytes=self.archive.stat().st_size,
                            archive_sha256=hashlib.sha256(self.archive.read_bytes()).hexdigest())
        self.reject()

    def test_symlink_and_fifo_archive_inputs_fail_without_hanging(self):
        target = self.root / "real.tar.gz"
        self.archive.rename(target)
        self.archive.symlink_to(target)
        self.reject()
        self.archive.unlink()
        os.mkfifo(self.archive)
        self.reject()

    def test_existing_output_is_preserved(self):
        self.output.mkdir()
        sentinel = self.output / "keep"
        sentinel.write_text("owned earlier work")
        result = self.consume()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(sentinel.read_text(), "owned earlier work")

    def test_symlink_output_and_parent_are_rejected(self):
        elsewhere = self.root / "elsewhere"
        elsewhere.mkdir()
        self.output.symlink_to(elsewhere, target_is_directory=True)
        result = self.consume()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list(elsewhere.iterdir()), [])
        self.output.unlink()
        linked_parent = self.root / "linked-parent"
        linked_parent.symlink_to(elsewhere, target_is_directory=True)
        result = self.cli("consume", "--archive", self.archive,
                          "--output-dir", linked_parent / "output")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list(elsewhere.iterdir()), [])

    def test_non_executable_symlink_and_fifo_producer_inputs_fail(self):
        self.binary.chmod(0o644)
        result = self.cli("pack", "--binary", self.binary, "--output-dir", self.root / "bad-pack")
        self.assertNotEqual(result.returncode, 0)
        self.binary.unlink()
        self.binary.symlink_to(self.archive)
        result = self.cli("pack", "--binary", self.binary, "--output-dir", self.root / "bad-pack")
        self.assertNotEqual(result.returncode, 0)
        self.binary.unlink()
        os.mkfifo(self.binary)
        result = self.cli("pack", "--binary", self.binary, "--output-dir", self.root / "bad-pack")
        self.assertNotEqual(result.returncode, 0)

    def test_controls_do_not_depend_on_python_assertions(self):
        result = self.consume(optimized=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.output.rename(self.root / "first-output")
        self.reject(receipt={**self.receipt, "run_attempt": 2}, optimized=True)

    def proof_cli(self, source=SOURCE):
        return subprocess.run([sys.executable, str(SCRIPT), "verify-proof", "--binary", str(self.binary),
                               "--proof-dir", str(self.root / "proof"), "--source", source],
                              capture_output=True, text=True, timeout=10)

    def make_proof(self):
        root = self.root / "proof"
        root.mkdir()
        observed = {"source": SOURCE, "binary": str(self.binary),
                    "binary_sha256": hashlib.sha256(self.binary.read_bytes()).hexdigest()}
        for case in ("g1", "g2"):
            data = {"identity": observed}
            if case == "g1":
                data["restarted"] = copy.deepcopy(observed)
            (root / f"all471-{case}-proof.json").write_text(json.dumps(data))
        return root

    def test_proofs_bind_initial_restart_and_second_goal_to_chosen_binary(self):
        self.make_proof()
        result = self.proof_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["binary_sha256"], self.receipt["binary_sha256"])

    def test_full_existing_collector_then_shared_binary_binding(self):
        result = self.consume()
        self.assertEqual(result.returncode, 0, result.stderr)
        chosen = Path(json.loads(result.stdout)["binary"])
        # Reuse the neighboring collector's complete behavioral fixture; the
        # new binding command must supplement its actual CLI, not replace it.
        sys.dont_write_bytecode = True
        spec = importlib.util.spec_from_file_location("proof_fixture", SCRIPT.with_name("browser-proof.test.py"))
        fixtures = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fixtures)
        root = self.root / "full-proof"
        root.mkdir()
        for case in ("g1", "g2"):
            directory = root / case
            directory.mkdir()
            value = fixtures.fixture(case)
            for identity in ([value["identity"], value["restarted"]] if case == "g1" else [value["identity"]]):
                identity.update(binary=str(chosen), binary_sha256=self.receipt["binary_sha256"])
            (directory / f"all471-{case}-proof.json").write_text(json.dumps(value))
            (directory / f"all471-{case}-cleanup.json").write_text(json.dumps({
                "pid": 123, "binaryPath": str(chosen), "baseUrl": "http://127.0.0.1:1234",
                "provider": "http://127.0.0.1:5678", "exitCode": 0, "signalCode": None,
            }))
        collected = subprocess.run([sys.executable, str(SCRIPT.with_name("browser-proof.py")),
                                    "--root", str(root), "--source", SOURCE],
                                   capture_output=True, text=True, timeout=10)
        self.assertEqual(collected.returncode, 0, collected.stderr)
        bound = subprocess.run([sys.executable, str(SCRIPT), "verify-proof", "--binary", str(chosen),
                                "--proof-dir", str(root / "all471-goal-proof-artifact"), "--source", SOURCE],
                               capture_output=True, text=True, timeout=10)
        self.assertEqual(bound.returncode, 0, bound.stderr)

    def test_proof_missing_wrong_source_or_changed_binary_fails(self):
        root = self.make_proof()
        self.assertNotEqual(self.proof_cli(source="b" * 40).returncode, 0)
        self.binary.write_bytes(b"changed after use")
        self.assertNotEqual(self.proof_cli().returncode, 0)
        (root / "all471-g2-proof.json").unlink()
        self.assertNotEqual(self.proof_cli().returncode, 0)

    def test_wrong_restart_hash_and_binary_path_fail(self):
        root = self.make_proof()
        proof = root / "all471-g1-proof.json"
        original = json.loads(proof.read_text())
        for field, wrong in (("binary_sha256", "f" * 64), ("binary", "/different/nac-web")):
            data = copy.deepcopy(original)
            data["restarted"][field] = wrong
            proof.write_text(json.dumps(data))
            self.assertNotEqual(self.proof_cli().returncode, 0)


if __name__ == "__main__":
    unittest.main()
