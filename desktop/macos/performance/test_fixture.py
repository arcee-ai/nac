"""Protocol correctness only. These are not NAC/UI performance measurements."""

import io
import copy
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from fixture import Fixture, MODEL, WORKLOAD, stream_parts, transcript
import run as performance


class FixtureContract(unittest.TestCase):
    def start(self, mode):
        evidence = io.StringIO()
        server = Fixture(mode, evidence)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(thread.join, 5)
        self.addCleanup(server.shutdown)
        return server, evidence

    def post(self, server, prompt, stream=False):
        body = json.dumps({"model": MODEL, "stream": stream,
                           "input": [{"role": "user", "content": prompt}]}).encode()
        request = Request(f"http://127.0.0.1:{server.server_port}/responses", body,
                          {"Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=20) as response:
                return response.read()
        except HTTPError as error:
            error.close()
            raise

    def test_transcript_real_http_and_no_replay(self):
        server, evidence = self.start("transcript")
        with self.assertRaises(HTTPError) as error:
            self.post(server, "wrong sequence")
        self.assertEqual(error.exception.code, 409)
        self.assertEqual(server.sequence, 0)
        for index in range(WORKLOAD["transcript"]["turns"]):
            expected = transcript(index)
            response = json.loads(self.post(server, expected["user"]))
            self.assertEqual(response["output"][0]["content"][0]["text"], expected["assistant"])
        with self.assertRaises(HTTPError) as error:
            self.post(server, "MAC_PERF_V1_TURN_064")
        self.assertEqual(error.exception.code, 409)
        records = [json.loads(row) for row in evidence.getvalue().splitlines()]
        self.assertEqual(len([r for r in records if r["event"] == "completed"]), 64)
        self.assertNotIn("Deterministic local performance fixture", evidence.getvalue())

    def test_full_stream_event_order_and_completion(self):
        server, evidence = self.start("stream")
        wire = self.post(server, "MAC_PERF_V1_STREAM", stream=True)
        events = [json.loads(row[6:]) for row in wire.decode().splitlines() if row.startswith("data: ")]
        deltas = [event["delta"] for event in events if event["type"] == "response.output_text.delta"]
        self.assertEqual(deltas, stream_parts())
        self.assertEqual(events[-2]["type"], "response.output_item.done")
        self.assertEqual(events[-1]["type"], "response.completed")
        self.assertEqual(events[-1]["response"]["output"][0]["content"][0]["text"], "".join(deltas))
        records = [json.loads(row) for row in evidence.getvalue().splitlines()]
        flushes = [row for row in records if row["event"] == "delta_flushed"]
        self.assertEqual(len(flushes), 257)
        self.assertEqual([row["delta_index"] for row in flushes], list(range(257)))
        self.assertTrue(all(row["monotonic_ns"] >= row["scheduled_ns"] for row in flushes))
        with self.assertRaises(HTTPError) as error:
            self.post(server, "MAC_PERF_V1_STREAM", stream=True)
        self.assertEqual(error.exception.code, 409)


class CollectionContract(unittest.TestCase):
    def setUp(self):
        self.contract = json.loads(Path(__file__).with_name("allocation-v2.json").read_text())

    def test_proposed_source_does_not_authorize_runtime(self):
        with self.assertRaisesRegex(ValueError, "nomination"):
            performance.require_approval(self.contract, self.contract["proposed_target_sha"],
                self.contract["proven_harness_base_sha"], "some-decision")

    def test_count_phase_and_signal_requirements_cannot_shrink(self):
        performance.validate_contract(self.contract, WORKLOAD)
        for change in ({"trusted_input_events": 99}, {"paired_blocks": 1},
                       {"required_raw_signals": ["memory"]}, {"input_batch_characters": 100}):
            altered = self.contract | change
            with self.assertRaises(ValueError):
                performance.validate_contract(altered, WORKLOAD)
        altered = copy.deepcopy(self.contract)
        altered["phases"][0]["cap_seconds"] += 1
        with self.assertRaisesRegex(ValueError, "Core cap"):
            performance.validate_contract(altered, WORKLOAD)

    def test_null_unknown_identity_and_wrong_units_are_missing_not_zero(self):
        for value in (None, {"status": "observed", "unit": "bytes", "samples": [None]},
                      {"status": "observed", "unit": "bytes", "samples": [{"status": "observed", "value": 0}]},
                      {"status": "observed", "unit": "ms", "samples": [{"status": "observed", "value": 0, "identity_verified": True}]}):
            result = performance.signal_completeness(self.contract, {"memory": value})
            self.assertFalse(result["raw_signal_coverage_complete"])
            self.assertIn("memory", result["missing_raw_signals"])

    def paired(self):
        return [{"pair": i, "arm": arm, "value": i + offset, "status": "observed", "unit": "ms",
                 "hardware_class": "unit-test-only", "workload": "input", "window_state": "active"}
                for i in range(20) for arm, offset in (("native", 0), ("browser", 1))]

    def test_distribution_requires_all_pairs_same_scope_and_valid_samples(self):
        samples = self.paired()
        result = performance.paired_distribution(samples)
        self.assertEqual(result["native"]["p95"], 18)
        self.assertEqual(result["paired_native_minus_browser"]["p50"], -1)
        broken = [samples[:-1], samples + [samples[0]]]
        for field, value in (("value", None), ("value", float("nan")), ("status", "failed"),
                             ("unit", "seconds"), ("hardware_class", "different-machine")):
            altered = copy.deepcopy(samples)
            altered[0][field] = value
            broken.append(altered)
        for rows in broken:
            with self.assertRaises(ValueError):
                performance.paired_distribution(rows)

    def test_probe_permission_failure_preserves_nulls_and_does_not_bind_identity(self):
        row = {"schema": "nac-mac-process-v1", "pid": 42, "status": "unavailable",
               "reason": "rusage_unavailable", "errno": 1, "identity": None, "cpu_user_raw": None}
        result = type("Result", (), {"returncode": 2, "stdout": json.dumps(row).encode()})()
        entry = {"role": "backend", "start": None}
        sampler = performance.Sampler(Path("probe-not-executed"), Path("unused"), Path("unused-ui"), None)
        with patch.object(performance.subprocess, "run", return_value=result):
            observed = sampler.sample(42, entry)
        self.assertIsNone(observed["cpu_user_raw"])
        self.assertIsNone(entry["start"])
        self.assertFalse(observed["full_process_set"])
        with patch.object(performance.subprocess, "run", return_value=result):
            with self.assertRaisesRegex(ValueError, "PID binding"):
                sampler.sample(43, entry)

    def test_evidence_never_overwrites_or_reads_a_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            original = Path(temporary) / "receipt.json"
            performance.write_json(original, {"status": "failed"})
            with self.assertRaises(FileExistsError):
                performance.write_json(original, {"status": "passed"})
            linked = Path(temporary) / "link.json"
            linked.symlink_to(original)
            with self.assertRaises(ValueError):
                performance.read_json(linked)
            self.assertEqual(json.loads(original.read_text())["status"], "failed")

    def test_zero_or_skipped_xctest_is_not_driver_qualification(self):
        valid = {"totalTestCount": 1, "passedTests": 1, "failedTests": 0, "skippedTests": 0, "result": "Passed"}
        performance.require_calibration_result(valid)
        for changed in ({"totalTestCount": 0}, {"skippedTests": 1}, {"passedTests": 0}, {"result": "Failed"}):
            with self.assertRaises(ValueError):
                performance.require_calibration_result(valid | changed)

    def test_unapproved_runtime_refusal_retains_failure_without_running_commands(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "attempt"
            with patch.object(performance.subprocess, "Popen", side_effect=AssertionError("Runtime must not start")):
                status = performance.main(["--calibrate", "--output", str(output),
                    "--target-sha", self.contract["proposed_target_sha"],
                    "--harness-sha", self.contract["proven_harness_base_sha"], "--dispatch-reference", "not-approved"])
            self.assertEqual(status, 2)
            receipt = json.loads((output / "attempt.json").read_text())
            self.assertEqual(receipt["result"], "ADMISSION_REFUSED")
            self.assertEqual(receipt["nac_performance_trials"], 0)
            self.assertIsNone(receipt["numerical_product_budgets"])

    def test_setup_budget_includes_checkout_time_before_runner_start(self):
        controller = object.__new__(performance.Calibration)
        controller.start = 10
        controller.deadline = 12610
        controller.caps = {"setup_and_private_release_build": 1200}
        controller.report = {}
        with patch.object(performance.time, "monotonic", return_value=300):
            controller.phase("setup_and_private_release_build")
        self.assertEqual(controller.phase_deadline, 1210)

    def test_cpu_unit_control_does_not_assume_silicon_timebase_is_one(self):
        before = {"status": "observed", "identity": {"start": "7"}, "cpu_user_raw": "0",
                  "cpu_system_raw": "0", "timebase_numer": 125, "timebase_denom": 3}
        after = before | {"cpu_user_raw": "1200000"}
        observed = performance.classify_cpu_unit(before, after, 50_000_000)
        self.assertEqual(observed["raw_unit"], "mach_absolute_ticks")
        self.assertIsNone(observed["product_cpu_budget"])
        changed = after | {"identity": {"start": "8"}}
        self.assertEqual(performance.classify_cpu_unit(before, changed, 50_000_000)["status"], "unavailable")
        self.assertEqual(performance.classify_cpu_unit(before, after, 0)["status"], "unavailable")


if __name__ == "__main__":
    unittest.main()
