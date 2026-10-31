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

from fixture import (ClosedSeeds, FiniteController, Fixture, MODEL, WORKLOAD,
                     stream_parts, transcript, trial_plan, verify_terminal_producer)
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

    def test_suite_provider_has_one_seed_then_exact_finite_stream_allowance(self):
        server, _ = self.start("suite")
        server.sequence = 63  # Earlier turns are exercised by the64-turn HTTP test.
        self.post(server, transcript(63)["user"])
        with self.assertRaises(HTTPError):
            self.post(server, transcript(63)["user"])
        for _ in range(42):
            result = json.loads(self.post(server, "MAC_PERF_V1_STREAM"))
            self.assertEqual(result["output"][0]["content"][0]["text"], "".join(stream_parts()))
        with self.assertRaises(HTTPError):
            self.post(server, "MAC_PERF_V1_STREAM")


class FiniteProtocolContract(unittest.TestCase):
    def setUp(self):
        self.contract = json.loads(Path(__file__).with_name("allocation-v2.json").read_text())

    def test_full_plan_pairs_order_controls_and_original_loads(self):
        plan = trial_plan(self.contract)
        self.assertEqual(len(plan), 420)
        for cell in WORKLOAD["finite_cells"]:
            rows = [r for r in plan if r["cell"] == cell["cell"]]
            self.assertEqual(len(rows), 42)
            for pair in range(20):
                arms = [r["arm"] for r in rows if r["pair"] == pair and not r["control_only"]]
                self.assertEqual(arms, ["native", "browser"] if pair % 2 == 0 else ["browser", "native"])
            self.assertEqual(sum(r["control_only"] for r in rows), 2)
            self.assertTrue(all(r["columns"] == 120 and r["rows"] == 36 and r["ptys_per_session"] == 1 for r in rows))
            if cell["input"]:
                self.assertTrue(all(r["trusted_events_per_surface"] == 100 for r in rows))
        for count in (1, 8):
            for state in ("active", "hidden"):
                rows = [r for r in plan if r["cell"] == f"idle_{count}_{'pty' if count == 1 else 'ptys'}_{state}"]
                self.assertEqual(len(rows), 42)
                self.assertTrue(all(r["session_count"] == count and r["duration_seconds"] == 30 for r in rows))
        self.assertFalse({"cold_launch", "consumer_window_reopen", "notifications"} & {r["cell"] for r in plan})

    def test_complete_dispatch_is_never_qualified_without_actual_raw_evidence(self):
        retained, invoked = [], []
        controller = FiniteController(self.contract, {"scope": "unit-test-only"}, retained.append, 0, clock=lambda: 1)
        def fake(row, end):
            invoked.append(row["trial"])
            row["pair"] = -1  # A callback cannot mutate the immutable plan/ledger.
            return {"execution_complete": True}
        result = controller.run(fake)
        self.assertEqual(invoked, list(range(420)))
        self.assertEqual(result["recorded_arms"], 420)
        self.assertIsNone(result["performance_distributions"])
        self.assertFalse(result["measurement_ready"])
        for cell in result["cells"].values():
            self.assertEqual(cell["executed_pairs"], 20)
            self.assertEqual(cell["qualified_pairs"], 0)
            self.assertEqual(cell["observer_off_arms"], 2)
        self.assertEqual(len(retained), 840)  # Durable start and terminal receipts.

    def test_failure_or_deadline_censors_tail_without_replacement_pairs(self):
        for kind in ("error", "deadline", "no_receipt"):
            now, invoked, retained = [1], [], []
            controller = FiniteController(self.contract, {}, retained.append, 0, clock=lambda: now[0])
            def fake(row, end):
                invoked.append(row["trial"])
                if kind == "error":
                    raise ValueError("simulated ownership failure")
                if kind == "deadline":
                    now[0] = end
                return {"execution_complete": kind != "no_receipt"}
            controller.run(fake)
            self.assertEqual(invoked, [0])
            self.assertEqual(controller.ledger.rows[0]["status"], "failed")
            self.assertEqual(len(controller.ledger.rows), 420)
            self.assertTrue(all(r["status"] == "censored" for r in controller.ledger.rows[1:]))
            self.assertTrue(all(r["receipt"] is None for r in controller.ledger.rows))

    def test_expired_core_never_invokes_fixture_or_driver(self):
        controller = FiniteController(self.contract, {}, lambda _: None, 0, clock=lambda: 12600 * 10**9)
        with patch("fixture.FixtureWorkloads.execute", side_effect=AssertionError("must not dispatch")) as execute:
            result = controller.run(execute)
        self.assertEqual(result["recorded_arms"], 420)
        execute.assert_not_called()

    def test_measurement_stays_closed_even_with_fabricated_nomination(self):
        with self.assertRaisesRegex(ValueError, "native runtime/PTY"):
            performance.require_collection_admission()
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "denied"
            contract = Path(folder) / "contract.json"
            proposed = self.contract | {"nominated_target_sha": "a" * 40,
                "nominated_harness_sha": "b" * 40, "dispatch_reference": "unit-test-only"}
            contract.write_text(json.dumps(proposed))
            with patch.object(performance, "OwnedCommand", side_effect=AssertionError("no process")):
                result = performance.main(["--collect", "--contract", str(contract), "--target-sha", "a" * 40,
                    "--harness-sha", "b" * 40, "--dispatch-reference", "unit-test-only", "--output", str(output)])
            self.assertEqual(result, 2)
            self.assertEqual(json.loads((output / "attempt.json").read_text())["nac_performance_trials"], 0)

    def test_closed_api_seeds_wait_for_exact_assistant_and_clone_without_wal(self):
        with tempfile.TemporaryDirectory() as folder:
            class FakeRunner:
                private = Path(folder)
                owned = []
                prompts = []
                session_index = 0
                stopped = []
                def environment(self, *_):
                    return {}
                def remaining(self):
                    return 100
                def launch_backend(self, engine, workspace, store, env, name):
                    store.write_bytes(b"unit-test-only closed fixture, not SQLite")
                    backend = type("FakeBackend", (), {"stop": lambda _: self.stopped.append(name)})()
                    self.owned.append(backend)
                    return backend, name
                def api(self, endpoint, path, body, method=None):
                    if path == "model-configs":
                        return {"config_id": "unit-model"}
                    if path == "projects":
                        return {"project_id": "unit-project"}
                    if path == "sessions":
                        self.session_index += 1
                        return {"metadata": {"session_id": f"unit-session-{self.session_index}"}}
                    if path.endswith("/presentation"):
                        assert method == "PUT" and body["expected_version"] == 0
                        return {}
                    if path.endswith("/runs"):
                        self.prompts.append(body["prompt"])
                        return {"run_id": "unit-run"}
                    return {"messages": [{"role": "assistant", "content": transcript(len(self.prompts) - 1)["assistant"]}]}
            fake = FakeRunner()
            seeds = ClosedSeeds(fake, Path("not-executed"), Path(folder), "http://unit.invalid").build()
            self.assertEqual(fake.prompts, [transcript(i)["user"] for i in range(64)])
            self.assertEqual([len(s["sessions"]) for s in seeds.values()], [1, 8, 1])
            self.assertEqual([s["turns"] for s in seeds.values()], [0, 0, 64])
            self.assertEqual(len(fake.stopped), 3)
            self.assertEqual(fake.owned, [])
            target = Path(folder) / "clone.db"
            ClosedSeeds.clone(seeds["transcript_1"], target)
            self.assertEqual(target.read_bytes(), seeds["transcript_1"]["path"].read_bytes())
            with self.assertRaises(ValueError):
                ClosedSeeds.clone(seeds["transcript_1"], target)
            seeds["transcript_1"]["path"].write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "changed"):
                ClosedSeeds.clone(seeds["transcript_1"], Path(folder) / "another.db")

    def test_pty_fixture_uses_existing_human_admission_and_rejects_partial_cardinality(self):
        sessions = [{"id": f"unit-{i}"} for i in range(8)]
        requests = []
        def api(endpoint, path, body):
            requests.append((endpoint, path, body))
            return {"protocol_version": 1, "terminal_id": path, "cols": 120, "rows": 36, "alive": True}
        runner = type("Fake", (), {"api": staticmethod(api)})()
        result = ClosedSeeds.open_ptys(runner, "http://owned-unit-endpoint.invalid", sessions)
        self.assertEqual(len(result), 8)
        self.assertEqual(len({r[2]["launch_id"] for r in requests}), 8)
        self.assertTrue(all(r[2]["protocol_version"] == 1 and "input" not in r[2] for r in requests))
        bad = type("Fake", (), {"api": staticmethod(lambda *_: {"protocol_version": 1,
            "terminal_id": "same-id", "cols": 120, "rows": 36, "alive": True})})()
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            ClosedSeeds.open_ptys(bad, "http://owned-unit-endpoint.invalid", sessions)

    def test_terminal_producer_accounting_rejects_holes_partial_writes_and_reordering(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "producer.jsonl"
            rows = [{"schema": "nac-mac-perf-terminal-v1", "batch": i, "scheduled_ns": i * 50_000_000,
                "written_ns": i * 50_000_000, "source_bytes": 4096, "total_source_bytes": (i + 1) * 4096}
                for i in range(600)]
            def save(values):
                path.write_text("\n".join(json.dumps(row) for row in values) + "\n")
            save(rows)
            self.assertEqual(verify_terminal_producer(path)["source_bytes"], 2_457_600)
            broken = [rows[:-1], [rows[1], rows[0], *rows[2:]]]
            partial = copy.deepcopy(rows)
            partial[-1]["source_bytes"] = 1
            broken.append(partial)
            for values in broken:
                save(values)
                with self.assertRaises(ValueError):
                    verify_terminal_producer(path)


class CollectionContract(unittest.TestCase):
    def setUp(self):
        self.contract = json.loads(Path(__file__).with_name("allocation-v2.json").read_text())

    def test_proposed_source_does_not_authorize_runtime(self):
        with self.assertRaisesRegex(ValueError, "nomination"):
            performance.require_approval(self.contract, self.contract["proposed_target_sha"],
                self.contract["proven_harness_base_sha"], "some-decision")

    def test_expired_budget_precedes_every_owned_process_creation(self):
        runner = performance.Calibration.__new__(performance.Calibration)
        runner.remaining = lambda: (_ for _ in ()).throw(TimeoutError("unit-test expired guard"))
        with patch.object(performance, "OwnedCommand", side_effect=AssertionError("must not spawn")):
            for operation in (lambda: runner.command(["not-executed"], "expired"),
                lambda: runner.launch_backend(None, None, None, None, "expired"),
                lambda: runner.fixture_support("suite")):
                with self.assertRaises(TimeoutError):
                    operation()

    def test_export_retains_nested_trial_receipts_without_profiles_or_raw_bundles(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            runner = performance.Calibration.__new__(performance.Calibration)
            runner.private = root / "private"
            runner.private.mkdir()
            runner.report = {}
            runner.args = SimpleNamespace(output=root / "export", source_root=root / "target", harness_root=root / "harness")
            trial = runner.private / "trial-0000"
            trial.mkdir()
            (trial / "ui.json").write_text(json.dumps({"private": str(runner.private)}))
            (trial / "home").mkdir()
            (trial / "home/personal.log").write_text("not exported")
            (trial / "trial.xcresult").mkdir()
            (trial / "trial.xcresult/raw.log").write_text("not exported")
            runner.export()
            index = json.loads((runner.args.output / "evidence-index.json").read_text())
            self.assertIn("trial-0000/ui.json", index)
            self.assertEqual(json.loads((runner.args.output / "trial-0000/ui.json").read_text())["private"], "<private-fixture>")
            self.assertFalse((runner.args.output / "trial-0000/home").exists())
            self.assertFalse((runner.args.output / "trial-0000/trial.xcresult").exists())
            self.assertEqual(runner.report["export_source_sha256"]["trial-0000/ui.json"], performance.digest(trial / "ui.json"))

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
        entry = {"role": "backend", "receipt": {"kind": "xcui_launch", "pid": 42,
            "executable": "/fixture/nac-web", "launch_unix_us": "7000123"}}
        sampler = performance.Sampler(Path("probe-not-executed"), Path("unused"), Path("unused-ui"), None)
        with patch.object(performance.subprocess, "run", return_value=result):
            observed = sampler.sample(42, entry)
        self.assertIsNone(observed["cpu_user_raw"])
        self.assertEqual(entry["receipt"]["launch_unix_us"], "7000123")
        self.assertIsNone(observed["role"])
        self.assertFalse(observed["full_process_set"])
        with patch.object(performance.subprocess, "run", return_value=result):
            self.assertEqual(sampler.sample(43, entry)["status"], "unavailable")

    def process_row(self):
        return {"schema": "nac-mac-process-v1", "status": "observed", "pid": 42,
            "executable": "/fixture/nac-web", "identity": {"start_mach_ticks": "500",
                "start_wall_seconds": "7", "start_wall_microseconds": "123"},
            "cpu_user_raw": "1234", "cpu_system_raw": "20", "resident_bytes": "1024"}

    def test_delayed_first_sample_replacement_executable_and_unknown_never_attribute(self):
        sampler = performance.Sampler(Path("never-executed"), Path("unused"), Path("unused-ui"), None)
        receipt = {"kind": "xcui_launch", "pid": 42, "executable": "/fixture/nac-web", "launch_unix_us": "7000123"}
        sampler.add(42, "shell", receipt)
        expected = copy.deepcopy(sampler.roots[42])
        replacement = self.process_row() | {"identity": {"start_mach_ticks": "900",
            "start_wall_seconds": "8", "start_wall_microseconds": "123"}}
        for row in (replacement, self.process_row() | {"executable": "/foreign/nac-web"},
                    self.process_row() | {"identity": None}):
            result = type("Result", (), {"returncode": 0, "stdout": json.dumps(row).encode()})()
            with patch.object(performance.subprocess, "run", return_value=result):
                observed = sampler.sample(42, sampler.roots[42])
            self.assertEqual(observed["status"], "unavailable")
            self.assertFalse(observed["attributed"])
            self.assertIsNone(observed["role"])
            self.assertIsNone(observed["cpu_user_raw"])
            self.assertEqual(sampler.roots[42], expected)  # No first-probe self-binding.
        with patch.object(performance.subprocess, "run") as probe:
            self.assertEqual(sampler.sample(42, {"role": "shell", "receipt": None})["status"], "unavailable")
            probe.assert_not_called()

    def test_owned_handle_exit_before_or_during_first_probe_discards_counters(self):
        handle = type("Handle", (), {"pid": 42, "poll": lambda _: 1})()
        receipt = {"kind": "owned_child", "pid": 42, "executable": "/fixture/nac-web",
                   "launch_window_us": (7000000, 7001000), "handle": handle}
        sampler = performance.Sampler(Path("never-executed"), Path("unused"), Path("unused-ui"), None)
        sampler.add(42, "backend", receipt)
        with patch.object(performance.subprocess, "run") as probe:
            observed = sampler.sample(42, sampler.roots[42])
            self.assertTrue(observed["owned_incarnation_dead"])
            probe.assert_not_called()
        calls = iter((None, 1))
        with patch.object(handle, "poll", side_effect=lambda: next(calls)):
            result = type("Result", (), {"returncode": 0, "stdout": json.dumps(self.process_row()).encode()})()
            with patch.object(performance.subprocess, "run", return_value=result):
                observed = sampler.sample(42, sampler.roots[42])
        self.assertEqual(observed["status"], "unavailable")
        self.assertIsNone(observed["cpu_user_raw"])
        missing_handle = {"role": "backend", "receipt": receipt | {"handle": None}}
        with patch.object(performance.subprocess, "run") as probe:
            observed = sampler.sample(42, missing_handle)
            probe.assert_not_called()
        self.assertEqual(observed["status"], "unavailable")
        self.assertFalse(observed.get("owned_incarnation_dead", False))

    def test_expected_launch_receipt_allows_matching_process_without_mutating_identity(self):
        sampler = performance.Sampler(Path("never-executed"), Path("unused"), Path("unused-ui"), None)
        receipt = {"kind": "xcui_launch", "pid": 42, "executable": "/fixture/nac-web", "launch_unix_us": "7000123"}
        sampler.add(42, "shell", receipt)
        result = type("Result", (), {"returncode": 0, "stdout": json.dumps(self.process_row()).encode()})()
        with patch.object(performance.subprocess, "run", return_value=result):
            row = sampler.sample(42, sampler.roots[42])
        self.assertTrue(row["attributed"])
        self.assertEqual(row["cpu_user_raw"], "1234")
        self.assertEqual(sampler.roots[42]["receipt"], receipt)

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
