"""Synthetic read-only artifact-ID and redirect negatives; no live download."""

import datetime as dt
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest import mock
from urllib.parse import urlencode

import image_approval_artifact as artifact


NOW = dt.datetime(2026, 11, 12, 5, 0, tzinfo=dt.timezone.utc)
BODY = b"synthetic ZIP bytes"
DIGEST = "sha256:" + hashlib.sha256(BODY).hexdigest()
PATH = ("/actions-results/9e291efb-4534-85cc-b1b8-5e01136c136b/"
        "workflow-job-run-faf4631a-22e4-55e9-a517-12ee5727a329/"
        "artifacts/" + "a" * 64 + ".zip")


def redirect(**changes):
    params = {"se": "2026-11-12T05:10:00Z", "sig": "signed", "sp": "r", "spr": "https"}
    params.update(changes)
    return "https://productionresultssa32.blob.core.windows.net" + PATH + "?" + urlencode(params)


class Response:
    def __init__(self, status, url, body=b"", headers=None):
        self.status, self.url, self.body = status, url, body
        self.headers = headers or {}
        self.offset = 0
        self.closed = False

    def geturl(self):
        return self.url

    def read(self, amount):
        data = self.body[self.offset:self.offset + amount]
        self.offset += len(data)
        return data

    def close(self):
        self.closed = True


class ArtifactDownloadTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.destination = Path(self.temporary.name) / "approved.zip"
        self.endpoint = "https://api.github.com/repos/arcee-ai/nac/actions/artifacts/789/zip"
        self.location = redirect()
        self.api_status = 302
        self.storage_status = 200
        self.body = BODY
        self.storage_headers = {"Content-Length": str(len(BODY))}
        self.requests = []

    def open(self, request, *, timeout):
        self.assertEqual(timeout, 30)
        self.requests.append(request)
        if len(self.requests) == 1:
            return Response(self.api_status, self.endpoint,
                            headers={"Location": self.location})
        return Response(self.storage_status, self.location,
                        self.body, self.storage_headers)

    def download(self):
        return artifact.download(789, DIGEST, self.destination,
            read_token="synthetic-read-token", open_request=self.open,
            clock=lambda: NOW)

    def test_fixed_id_digest_and_no_token_forwarding(self):
        self.assertEqual(self.download(), self.destination)
        self.assertEqual(self.destination.read_bytes(), BODY)
        self.assertEqual(len(self.requests), 2)
        self.assertEqual(self.requests[0].full_url, self.endpoint)
        self.assertEqual(self.requests[0].get_header("Authorization"),
                         "Bearer synthetic-read-token")
        self.assertEqual(self.requests[1].full_url, self.location)
        self.assertIsNone(self.requests[1].get_header("Authorization"))

    def test_wrong_origin_path_or_signature_never_contacts_storage(self):
        changed = [
            self.location.replace("https://", "http://", 1),
            self.location.replace("productionresultssa32", "evilproductionresultssa32"),
            self.location.replace("blob.core.windows.net", "blob.core.windows.net.evil"),
            self.location.replace(".blob.core", ":443.blob.core"),
            self.location.replace("/actions-results/", "/other/"),
            self.location.replace("/artifacts/", "/artifacts/../"),
            self.location.replace("sig=signed", "sig="),
            self.location + "&sig=second",
            redirect(se="2026-11-12T04:59:59Z"),
            redirect(se="2026-11-12T06:00:00Z"),
            redirect(sp="w"),
        ]
        for location in changed:
            with self.subTest(location=location[:90]):
                self.location = location
                self.requests = []
                with self.assertRaises(ValueError):
                    self.download()
                self.assertEqual(len(self.requests), 1)
                self.assertFalse(self.destination.exists())

    def test_wrong_api_or_storage_status_and_length_fail_closed(self):
        self.api_status = 200
        with self.assertRaisesRegex(ValueError, "expected redirect"):
            self.download()
        self.assertFalse(self.destination.exists())
        self.api_status = 302
        self.requests = []
        self.storage_status = 302
        with self.assertRaisesRegex(ValueError, "redirected or failed"):
            self.download()
        self.storage_status = 200
        self.requests = []
        self.storage_headers = {"Content-Length": str(len(BODY) + 1)}
        with self.assertRaisesRegex(ValueError, "bytes or length differ"):
            self.download()
        self.assertFalse(self.destination.exists())
        self.requests = []
        self.storage_headers = {"Content-Length": str(artifact.MAX_ZIP_BYTES + 1)}
        with self.assertRaisesRegex(ValueError, "length exceeds bound"):
            self.download()
        self.assertFalse(self.destination.exists())

    def test_changed_bytes_and_stream_bound_remove_partial_file(self):
        self.body = BODY + b"x"
        self.storage_headers = {"Content-Length": str(len(self.body))}
        with self.assertRaisesRegex(ValueError, "bytes or length differ"):
            self.download()
        self.assertFalse(self.destination.exists())
        self.requests = []
        self.storage_headers = {}
        with mock.patch.object(artifact, "MAX_ZIP_BYTES", 4):
            with self.assertRaisesRegex(ValueError, "archive exceeds byte bound"):
                self.download()
        self.assertFalse(self.destination.exists())

    def test_invalid_subject_output_or_token_rejected_before_http(self):
        with self.assertRaises(ValueError):
            artifact.download(0, DIGEST, self.destination,
                read_token="read", open_request=self.open, clock=lambda: NOW)
        with self.assertRaises(ValueError):
            artifact.download(789, "sha256:invalid", self.destination,
                read_token="read", open_request=self.open, clock=lambda: NOW)
        with self.assertRaises(ValueError):
            artifact.download(789, DIGEST, self.destination,
                read_token="", open_request=self.open, clock=lambda: NOW)
        self.destination.symlink_to(Path(self.temporary.name) / "other")
        with self.assertRaises(ValueError):
            self.download()
        self.assertEqual(self.requests, [])

    def test_no_live_workflow_invokes_artifact_reader(self):
        root = Path(__file__).resolve().parents[2]
        for workflow in (root / ".github/workflows").glob("*.yml"):
            self.assertNotIn("image_approval_artifact", workflow.read_text())


if __name__ == "__main__":
    unittest.main()
