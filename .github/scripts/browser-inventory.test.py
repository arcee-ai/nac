import copy
import importlib.util
import pathlib
import sys
import unittest

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location(
    "browser_inventory", pathlib.Path(__file__).with_name("browser-inventory.py")
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def report(names):
    return {
        "config": {"workers": 1, "fullyParallel": False, "projects": [{"retries": 0}]},
        "errors": [],
        "suites": [{"suites": [{"specs": [
            {"id": name, "file": "exact-goal-wait.e2e.ts" if name.startswith("proof") else "example.e2e.ts", "line": i + 1, "column": 1,
             "title": name, "tests": [{"projectId": "", "expectedStatus": "passed"}]}
            for i, name in enumerate(names)
        ]}]}],
    }


class BrowserInventoryTests(unittest.TestCase):
    def setUp(self):
        self.complete = report(["proof1", "proof2", "first", "second", "third"])
        self.parts = [copy.deepcopy(self.complete) for _ in range(3)]
        for part in self.parts[1:]:
            part["config"]["fullyParallel"] = True
        self.parts[0]["suites"][0]["suites"][0]["specs"] = self.parts[0]["suites"][0]["suites"][0]["specs"][:2]
        self.parts[1]["suites"][0]["suites"][0]["specs"] = self.parts[1]["suites"][0]["suites"][0]["specs"][2:4]
        self.parts[2]["suites"][0]["suites"][0]["specs"] = self.parts[2]["suites"][0]["suites"][0]["specs"][4:]

    def test_exact_disjoint_partition(self):
        self.assertEqual(MODULE.validate(self.complete, self.parts), 5)

    def test_missing_shard_fails(self):
        with self.assertRaisesRegex(ValueError, "1 missing"):
            MODULE.validate(self.complete, self.parts[:2])

    def test_duplicate_shard_fails(self):
        with self.assertRaisesRegex(ValueError, "duplicated"):
            MODULE.validate(self.complete, self.parts + self.parts[1:2])

    def test_wrong_test_fails(self):
        self.parts[1]["suites"][0]["suites"][0]["specs"][0]["id"] = "unexpected"
        with self.assertRaisesRegex(ValueError, "1 missing, 1 unexpected"):
            MODULE.validate(self.complete, self.parts)

    def test_extra_skips_fail(self):
        self.parts[1]["suites"][0]["suites"][0]["specs"][0]["tests"][0]["expectedStatus"] = "skipped"
        with self.assertRaisesRegex(ValueError, "1 missing, 1 unexpected"):
            MODULE.validate(self.complete, self.parts)

    def test_collection_errors_fail(self):
        self.parts[1]["errors"] = [{"message": "import failed"}]
        with self.assertRaisesRegex(ValueError, "collection errors"):
            MODULE.validate(self.complete, self.parts)

    def test_parallel_config_change_fails(self):
        self.parts[1]["config"]["fullyParallel"] = False
        with self.assertRaisesRegex(ValueError, "parallel mode"):
            MODULE.validate(self.complete, self.parts)

    def test_proof_and_complete_cannot_be_parallel(self):
        for report in [self.complete, self.parts[0]]:
            report["config"]["fullyParallel"] = True
            with self.assertRaisesRegex(ValueError, "parallel mode"):
                MODULE.validate(self.complete, self.parts)
            report["config"]["fullyParallel"] = False

    def test_proof_must_be_first_complete_and_excluded_from_ordinary(self):
        proof = self.parts[0]["suites"][0]["suites"][0]["specs"]
        self.parts[0]["suites"][0]["suites"][0]["specs"] = proof[:1]
        with self.assertRaisesRegex(ValueError, "complete unchanged serial proof"):
            MODULE.validate(self.complete, self.parts)
        self.parts[0]["suites"][0]["suites"][0]["specs"] = proof
        self.parts[1]["suites"][0]["suites"][0]["specs"].append(proof[0])
        with self.assertRaisesRegex(ValueError, "cannot include proof"):
            MODULE.validate(self.complete, self.parts)

    def test_additional_workers_fail_in_either_lane(self):
        for report in [self.parts[0], self.parts[1]]:
            report["config"]["workers"] = 2
            with self.assertRaisesRegex(ValueError, "one worker"):
                MODULE.validate(self.complete, self.parts)
            report["config"]["workers"] = 1

    def test_retries_change_fails(self):
        self.parts[1]["config"]["projects"][0]["retries"] = 1
        with self.assertRaisesRegex(ValueError, "zero retries"):
            MODULE.validate(self.complete, self.parts)

    def test_empty_inventory_fails(self):
        empty = report([])
        empty["config"]["fullyParallel"] = True
        with self.assertRaisesRegex(ValueError, "empty"):
            MODULE.validate(self.complete, [self.parts[0], empty])


if __name__ == "__main__":
    unittest.main()
