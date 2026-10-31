"""Protocol correctness only. These are not NAC/UI performance measurements."""

import io
import json
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from fixture import Fixture, MODEL, WORKLOAD, stream_parts, transcript


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


if __name__ == "__main__":
    unittest.main()
