"""Inert handler regression sources. No sockets, provider threads or apps."""
import io
from pathlib import Path
import unittest
from unittest.mock import patch

from quit_fixture import QuitProvider, TRANSCRIPT
from storage_q1 import provider_no_send


class SocketBytes:
    def __init__(self, raw):
        self.input = io.BytesIO(raw)
        self.output = bytearray()

    def makefile(self, *_args):
        return self.input

    def sendall(self, data):
        self.output.extend(data)


class InertServer:
    def __init__(self, address, handler):
        self.handler = handler
        self.server_port = address[1] or 18080
        self.hold_connections = False
        self.pending = []

    def process_request(self, connection, address):
        if self.hold_connections:
            self.pending.append((connection, address))
            return
        try:
            self.handler(connection, address, self)
        except Exception:
            pass  # Match ThreadingMixIn's worker exception boundary without a thread.

    def release_pending(self):
        pending, self.pending = self.pending, []
        for connection, address in pending:
            self.handler(connection, address, self)

    def serve_forever(self):
        raise AssertionError('No serving allowed in inert controls')

    def shutdown(self):
        pass

    def server_close(self):
        pass


class InertThread:
    def __init__(self, **_kwargs):
        pass

    def start(self):
        pass

    def join(self, **_kwargs):
        pass

    def is_alive(self):
        return False


class ProviderObservationTests(unittest.TestCase):
    def setUp(self):
        self.server = patch('quit_fixture.ThreadingHTTPServer', InertServer)
        self.thread = patch('quit_fixture.threading.Thread', InertThread)
        self.server.start(); self.thread.start()
        self.addCleanup(self.server.stop); self.addCleanup(self.thread.stop)
        self.provider = QuitProvider(Path('/inert/no-filesystem-access'))

    def ingress(self, raw):
        connection = SocketBytes(raw)
        try:
            self.provider.server.process_request(connection, ('127.0.0.1', 1))
        except (ValueError, TypeError):
            pass  # The real handler still propagates malformed body/length errors.
        return self.provider.ingress_snapshot()

    def test_http11_keepalive_request_still_closes_http10_fixture_after_one_read(self):
        provider = QuitProvider(Path('/inert/no-filesystem-access'), q1_metadata=True)
        connection = SocketBytes(b'GET /models HTTP/1.1\r\nConnection: keep-alive\r\n\r\n')
        class NoIdleReread(type(connection.input)):
            def readline(self, *args):
                if self.tell() == len(self.getvalue()):
                    raise AssertionError('unexpected idle second request read')
                return super().readline(*args)
        connection.input = NoIdleReread(connection.input.getvalue())
        provider.server.process_request(connection, ('127.0.0.1', 1))
        self.assertTrue(bytes(connection.output).startswith(b'HTTP/1.0 200'))
        snapshot = provider.ingress_snapshot()
        self.assertEqual(snapshot['total'], 1)
        self.assertEqual(snapshot['connectionsActive'], 0)
        self.assertEqual(provider_no_send(snapshot), 0)
        provider.close()
        self.assertEqual(provider_no_send(provider.ingress_snapshot(), final=True), 0)

    def test_catalog_only_requires_closed_complete_census(self):
        before = self.ingress(b'GET /models-dev HTTP/1.0\r\n\r\n')
        self.assertEqual(before['total'], 1)
        self.assertEqual(provider_no_send(before), 0)
        with self.assertRaises(ValueError): provider_no_send(before, final=True)
        self.provider.close()
        self.assertEqual(provider_no_send(self.provider.ingress_snapshot(), final=True), 0)

    def test_early_invalid_and_unknown_requests_are_not_zero_filled(self):
        for raw in (b'POST /foreign HTTP/1.0\r\nContent-Length: 1\r\n\r\nx',
                    b'POST /responses HTTP/1.0\r\nContent-Length: nope\r\n\r\n',
                    b'POST /responses HTTP/1.0\r\nContent-Length: 1\r\n\r\n{',
                    b'POST /responses HTTP/1.0\r\nContent-Length: 2\r\n\r\n{}',
                    b'HEAD /models-dev HTTP/1.0\r\n\r\n',
                    b'X' * 65538 + b'\r\n'):
            snapshot = self.ingress(raw)
            self.assertGreater(snapshot['total'], 0)
            self.assertEqual(snapshot['connectionsActive'], 0)
            with self.assertRaises(ValueError): provider_no_send(snapshot)
        self.assertEqual(self.provider.requests, [])

    def test_recognized_inference_still_fails_no_send(self):
        import json
        body = json.dumps(dict(input=TRANSCRIPT)).encode()
        raw = b'POST /responses HTTP/1.0\r\nContent-Length: ' + str(len(body)).encode() + b'\r\n\r\n' + body
        snapshot = self.ingress(raw)
        self.assertEqual(snapshot['rows'][0]['recognized'], 'transcript')
        with self.assertRaises(ValueError): provider_no_send(snapshot)

    def test_overflow_pending_and_missing_facts_fail(self):
        for _ in range(257): self.ingress(b'GET /models-dev HTTP/1.0\r\n\r\n')
        snapshot = self.provider.ingress_snapshot()
        self.assertTrue(snapshot['overflow'])
        self.assertEqual(len(snapshot['rows']), 256)
        with self.assertRaises(ValueError): provider_no_send(snapshot)
        with self.assertRaises(ValueError): provider_no_send({})
        self.provider._connections_active += 1
        self.assertFalse(self.provider.ingress_snapshot()['complete'])


    def test_accepted_connection_pending_through_close_stays_incomplete(self):
        self.provider.server.hold_connections = True
        self.provider.server.process_request(SocketBytes(b'GET /models-dev HTTP/1.0\r\n\r\n'),
                                             ('127.0.0.1', 1))
        admitted = self.provider.ingress_snapshot()
        self.assertEqual(admitted['connectionsActive'], 1)
        self.assertEqual(admitted['total'], 0)
        self.provider.close()
        closed = self.provider.ingress_snapshot()
        self.assertTrue(closed['closed'])
        self.assertFalse(closed['complete'])
        with self.assertRaises(ValueError): provider_no_send(closed, final=True)
        # The accepted worker can finish after serving stops. Only then is its
        # actual handler/connection completion reflected in a complete census.
        self.provider.server.release_pending()
        finished = self.provider.ingress_snapshot()
        self.assertEqual(finished['connectionsActive'], 0)
        self.assertEqual(finished['total'], 1)
        self.assertEqual(provider_no_send(finished, final=True), 0)

    def test_timeout_or_error_before_parse_cannot_become_empty_complete_census(self):
        class FailingInput(io.BytesIO):
            def __init__(self, error):
                super().__init__(b'POST /responses')
                self.error = error

            def readline(self, *_args):
                raise self.error

        for error in (TimeoutError('partial request timed out'), OSError('request stream failed')):
            with self.subTest(error=type(error).__name__):
                connection = SocketBytes(b'')
                connection.input = FailingInput(error)
                # Executes the real BaseHTTPRequestHandler read/error path;
                # InertServer only replaces worker dispatch, not HTTP parsing.
                self.provider.server.process_request(connection, ('127.0.0.1', 1))
                snapshot = self.provider.ingress_snapshot()
                self.assertEqual(snapshot['connectionsActive'], 0)
                with self.assertRaises(ValueError): provider_no_send(snapshot)


    def test_q1_exact_models_index_is_read_only_and_default_mode_stays_rejected(self):
        import json
        provider=QuitProvider(Path('/inert/no-filesystem-access'),q1_metadata=True)
        connection=SocketBytes(b'GET /models HTTP/1.0\r\n\r\n')
        provider.server.process_request(connection,('127.0.0.1',1))
        body=bytes(connection.output).split(b'\r\n\r\n',1)[1]
        self.assertEqual(json.loads(body),dict(object='list',data=[dict(id='gpt-5.6-sol',object='model')]))
        provider.close()
        self.assertEqual(provider_no_send(provider.ingress_snapshot(),final=True),0)
        self.assertEqual(provider.requests,[])
        unknown=self.ingress(b'GET /models HTTP/1.0\r\n\r\n')
        with self.assertRaises(ValueError):provider_no_send(unknown)
        provider.server.process_request(SocketBytes(b'GET /models?foreign=1 HTTP/1.0\r\n\r\n'),('127.0.0.1',1))
        with self.assertRaises(ValueError):provider_no_send(provider.ingress_snapshot())


if __name__ == '__main__': unittest.main()
