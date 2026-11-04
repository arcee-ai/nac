"""Inert lower-bound feasibility, not live campaign caps or product budgets.

The fake clock charges only settlement and manifest duration. Real launch,
input, accounting and export overhead is unmeasured; collection stays refused.
The corrected streaming/terminal/hide margins are only 0.4/1/1 seconds.
"""

from collections import Counter
import copy
from decimal import Decimal
import json
from pathlib import Path
import unittest

from fixture import FiniteController, trial_plan


NANOSECONDS = 1_000_000_000
ORIGINAL_CAPS = {
    "fresh_and_warm_launch": 840,
    "streaming_and_input": 720,
    "noisy_terminal_and_input": 1440,
    "preview_hide_reshow": 360,
}


def lower_bound_run(contract):
    """Exercise the real planner/controller without any workload adapter."""
    caps = {phase["name"]: phase["cap_seconds"] for phase in contract["phases"]}
    # Charge the full setup/calibration reserves before trial dispatch. The
    # positive tick distinguishes elapsed time from the controller's epoch.
    now = [(caps["setup_and_private_release_build"]
            + caps["calibration_and_process_attribution"]) * NANOSECONDS + 1]
    retained = []
    controller = FiniteController(contract, {"scope": "inert-lower-bound-only"},
                                  retained.append, 0, clock=lambda: now[0])

    def execute(row, _deadline):
        seconds = Decimal(str(row["settle_seconds"])) + Decimal(str(row["duration_seconds"]))
        now[0] += int(seconds * NANOSECONDS)
        return {"execution_complete": True, "scope": "inert-lower-bound-only"}

    summary = controller.run(execute)
    return controller, summary, retained


class AllocationFeasibilityContract(unittest.TestCase):
    def setUp(self):
        self.contract = json.loads(Path(__file__).with_name("allocation-v2.json").read_text())

    def assert_unqualified(self, controller, summary):
        self.assertEqual(summary["recorded_arms"], 420)
        self.assertFalse(summary["measurement_ready"])
        self.assertIsNone(summary["performance_distributions"])
        self.assertTrue(all(not row["qualified"] for row in controller.ledger.rows))
        self.assertTrue(all(cell["qualified_pairs"] == 0 for cell in summary["cells"].values()))

    def test_original_caps_retain_failure_and_entire_censored_tail(self):
        original = copy.deepcopy(self.contract)
        for phase in original["phases"]:
            phase["cap_seconds"] = ORIGINAL_CAPS.get(phase["name"], phase["cap_seconds"])
        self.assertEqual(trial_plan(original), trial_plan(self.contract))
        controller, summary, retained = lower_bound_run(original)
        self.assertEqual(Counter(row["status"] for row in controller.ledger.rows),
                         {"executed": 334, "failed": 1, "censored": 85})
        failed = controller.ledger.rows[334]
        self.assertEqual((failed["trial"], failed["cell"], failed["observer"], failed["position"]),
                         (334, "streaming", "off", 0))
        self.assertIn("TimeoutError", failed["reason"])
        self.assertTrue(all(row["reason"] == "stopped_after_trial_failure"
                            for row in controller.ledger.rows[335:]))
        self.assertEqual(sum(row["schema"] == "nac-mac-trial-start-v1" for row in retained), 335)
        self.assert_unqualified(controller, summary)

    def test_allocated_caps_fit_only_the_unchanged_lower_bound(self):
        controller, summary, retained = lower_bound_run(self.contract)
        self.assertEqual(Counter(row["status"] for row in controller.ledger.rows), {"executed": 420})
        self.assertEqual(len(retained), 840)
        self.assertEqual(sum(not row["control_only"] for row in controller.ledger.rows), 400)
        self.assertEqual(sum(row["control_only"] for row in controller.ledger.rows), 20)
        self.assertEqual(len(summary["cells"]), 10)
        for cell in summary["cells"].values():
            self.assertEqual((cell["planned_pairs"], cell["executed_pairs"], cell["observer_off_arms"]),
                             (20, 20, 2))
        self.assertEqual(sum(phase["cap_seconds"] for phase in self.contract["phases"]), 12600)
        self.assertEqual((self.contract["core_cap_seconds"], self.contract["upload_cleanup_envelope_seconds"],
                          self.contract["workflow_timeout_minutes"]), (12600, 600, 220))
        self.assert_unqualified(controller, summary)

    def test_exact_terminal_and_hide_phase_minima_still_fail_at_equality(self):
        for name, cap, failed_trial in (("noisy_terminal_and_input", 1470, 377),
                                        ("preview_hide_reshow", 420, 419)):
            with self.subTest(phase=name):
                contract = copy.deepcopy(self.contract)
                phase = next(p for p in contract["phases"] if p["name"] == name)
                released = phase["cap_seconds"] - cap
                phase["cap_seconds"] = cap
                next(p for p in contract["phases"] if p["name"] == "fresh_and_warm_launch")["cap_seconds"] += released
                self.assertEqual(sum(p["cap_seconds"] for p in contract["phases"]), 12600)
                controller, summary, _ = lower_bound_run(contract)
                failed = controller.ledger.rows[failed_trial]
                self.assertEqual(failed["status"], "failed")
                self.assertEqual(failed["ended_monotonic_ns"], failed["deadline_monotonic_ns"])
                self.assertEqual(Counter(row["status"] for row in controller.ledger.rows),
                                 Counter({"executed": failed_trial, "failed": 1,
                                          "censored": 419 - failed_trial}))
                self.assert_unqualified(controller, summary)


if __name__ == "__main__":
    unittest.main()
