#!/usr/bin/env python3
"""Capability fixtures and bounded fake CLI children; never query real Docker."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("image-build-driver.py")
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("image_build_driver", SCRIPT)
DRIVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRIVER)
INFO = {"ServerVersion": "29.4.2", "OSType": "linux", "Architecture": "x86_64",
        "Driver": "overlayfs", "DriverStatus": [["driver-type", "io.containerd.snapshotter.v1"]]}
VERSION = "github.com/docker/buildx v0.38.1 0dbe87f36ed472fe36b6796c3f70b4210a731fc5"
INSPECT = """Name:          default
Driver:        docker

Nodes:
Name:             default
Endpoint:         default
Status:           running
BuildKit version: v0.32.2
Platforms:        linux/amd64, linux/amd64/v2, linux/arm64
Labels:
 org.mobyproject.buildkit.worker.snapshotter: overlayfs
"""


class Capability(unittest.TestCase):
    def select(self, info=INFO, version=VERSION, context="default", inspection=INSPECT):
        with patch.object(DRIVER, "query", side_effect=[json.dumps(info), version, context, inspection]):
            return DRIVER.select()

    def test_reviewed_native_containerd_configuration(self):
        self.assertEqual(self.select(), "docker")
        self.assertTrue(DRIVER.supported(INFO, VERSION, "default", INSPECT))
        self.assertEqual(self.select(inspection=INSPECT.replace("v0.32.2", "v0.20.0")), "docker")
        self.assertEqual(self.select(inspection=INSPECT.replace("v0.32.2", "v0.34.2")), "docker")

    def test_info_negative_controls(self):
        changes = [("ServerVersion", "28.0.0"), ("ServerVersion", "30.0.0"),
                   ("ServerVersion", "29.4.2-dev"), ("ServerVersion", 29),
                   ("OSType", "windows"), ("Architecture", "aarch64"),
                   ("Driver", "overlay2"), ("DriverStatus", None), ("DriverStatus", []),
                   ("DriverStatus", [["driver-type", "overlay2"]]),
                   ("DriverStatus", [["driver-type", "io.containerd.snapshotter.v1"]] * 2),
                   ("DriverStatus", [["driver-type", "io.containerd.snapshotter.v1", "extra"]]),
                   ("DriverStatus", [["driver-type", {"unsafe": "value"}]]),
                   ("DriverStatus", [["x" * 257, "value"]])]
        for key, value in changes:
            with self.subTest(key=key, value=value):
                info = copy.deepcopy(INFO)
                info[key] = value
                self.assertEqual(self.select(info), "docker-container")
        for info in [None, [], {}, {**INFO, "unreviewed": "field"}]:
            with self.subTest(info=info):
                self.assertEqual(self.select(info), "docker-container")

    def test_builder_negative_controls(self):
        changes = [("Driver:        docker", "Driver:        docker-container"),
                   ("Status:           running", "Status:           stopped"),
                   ("Endpoint:         default", "Endpoint:         remote"),
                   ("Name:          default", "Name:          other"),
                   ("linux/amd64, linux/amd64/v2, linux/arm64", "linux/arm64"),
                   ("v0.32.2", "v0.19.9"), ("v0.32.2", "v0.35.0"),
                   ("v0.32.2", "v1.0.0"), ("v0.32.2", "v0.32.2-dev"),
                   ("Nodes:", ""), ("Nodes:", "Nodes:\nNodes:"),
                   ("Status:           running", "Status: running\nStatus: running"),
                   ("Platforms:", "Unknown:"), ("Labels:", "Error: failure\nLabels:")]
        for before, after in changes:
            with self.subTest(before=before, after=after):
                self.assertEqual(self.select(inspection=INSPECT.replace(before, after)), "docker-container")
        for version in ["", VERSION.replace("0.38.1", "0.38.2"), VERSION.replace("0.38.1", "1.0.0"),
                        VERSION + "\ndriver=docker"]:
            self.assertEqual(self.select(version=version), "docker-container")
        for context in ["desktop-linux", "remote", "--bootstrap", "default\ndriver=docker"]:
            self.assertEqual(self.select(context=context), "docker-container")

    def test_malformed_json_and_failed_queries_never_escape(self):
        for data in ["{", "{}\ndriver=docker", '{"ServerVersion":"29.4.2","ServerVersion":"29.4.2"}']:
            with patch.object(DRIVER, "query", return_value=data):
                self.assertEqual(DRIVER.select(), "docker-container")
        for error in [OSError(), ValueError(), subprocess.TimeoutExpired("docker", 10), RecursionError()]:
            with patch.object(DRIVER, "query", side_effect=error):
                self.assertEqual(DRIVER.select(), "docker-container")

    def fake_docker(self, root, source):
        path = root / "docker"
        path.write_text(f"#!{sys.executable}\n" + source)
        path.chmod(0o700)
        return {**os.environ, "PATH": str(root) + os.pathsep + os.environ["PATH"]}

    def test_query_byte_time_exit_and_encoding_bounds(self):
        with tempfile.TemporaryDirectory(prefix="nac-driver-query-") as directory:
            root = Path(directory)
            for source in ["import sys; sys.stdout.write('x' * 65537)\n", "raise SystemExit(2)\n",
                           "import sys; sys.stdout.buffer.write(b'\\xff')\n", "import time; time.sleep(5)\n"]:
                env = self.fake_docker(root, source)
                with patch.dict(os.environ, env, clear=True), patch.object(DRIVER, "TIMEOUT", 0.2):
                    with self.assertRaises((ValueError, UnicodeError, subprocess.SubprocessError)):
                        DRIVER.query(["info"])

    def test_real_entrypoint_emits_only_hardcoded_output(self):
        with tempfile.TemporaryDirectory(prefix="nac-driver-output-") as directory:
            root = Path(directory)
            for data, expected in [(INFO, "docker"), ({**INFO, "Driver": "docker\ndriver=unsafe"}, "docker-container")]:
                source = ("import sys,json\n"
                          f"values = {{'info': {json.dumps(json.dumps(data))}, 'buildx version': {VERSION!r}, "
                          f"'context show': 'default', 'buildx inspect default': {INSPECT!r}}}\n"
                          "key = ' '.join(sys.argv[1:]); print(values['info'] if key.startswith('info ') else values[key])\n")
                env = self.fake_docker(root, source)
                result = subprocess.run([sys.executable, SCRIPT], env=env, text=True,
                                        capture_output=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, f"driver={expected}\n")
                self.assertEqual(result.stderr, "")

    def test_timeout_settles_plugin_group_and_retains_unrelated_sentinel(self):
        with tempfile.TemporaryDirectory(prefix="nac-driver-processes-") as directory:
            root = Path(directory)
            sentinel = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"],
                                        start_new_session=True)
            try:
                record = root / "pids.json"
                source = ("import os,json,subprocess,sys,time\n"
                          "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])\n"
                          f"open({str(record)!r}, 'w').write(json.dumps({{'parent':os.getpid(),'child':child.pid}}))\n"
                          "time.sleep(30)\n")
                env = self.fake_docker(root, source)
                started = time.monotonic()
                with patch.dict(os.environ, env, clear=True), patch.object(DRIVER, "TIMEOUT", 1):
                    with self.assertRaises(ValueError):
                        DRIVER.query(["buildx", "inspect", "default"])
                self.assertLess(time.monotonic() - started, 3)
                ids = json.loads(record.read_text())
                self.assertNotEqual(ids["parent"], os.getpgid(sentinel.pid))
                self.assertIsNone(sentinel.poll(), "unrelated process must survive query cleanup")
                for pid in ids.values():
                    state = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)],
                                           capture_output=True, text=True, timeout=2).stdout.strip()
                    self.assertTrue(not state or state.startswith("Z"), f"owned process still running: {pid}")
            finally:
                sentinel.terminate()
                sentinel.wait(timeout=2)


if __name__ == "__main__":
    unittest.main()
