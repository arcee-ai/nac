#!/usr/bin/env python3
"""Disposable auth double. Only native E2E can establish browser handoff.

No request targets, callback URLs, codes, PKCE verifiers, or tokens are logged.
The production provider's fixed issuer is never changed by this fixture.
"""
import base64
from contextlib import AbstractContextManager
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import secrets
import sys
import threading
import time
from urllib.parse import parse_qs, urlencode, urlsplit


class AuthFixture(AbstractContextManager):
    def __init__(self, callback='http://localhost:1456/mcp_library/oauth/callback', clock=time.monotonic,
                 device_mode='success', device_timeout_seconds=3):
        if device_mode not in ('success', 'denied', 'expired', 'hold', 'timeout'):
            raise ValueError('Unknown device fixture mode')
        if type(device_timeout_seconds) is not int or device_timeout_seconds not in (3, 15):
            raise ValueError('Device fixture timeout must use the owner or native scheduling allowance')
        self.callback = callback
        self.clock = clock
        self.device_mode = device_mode
        self.device_timeout_seconds = device_timeout_seconds
        self.lock = threading.Lock()
        self.codes = {}
        self.devices = {}
        self.events = []
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), self.handler())
        self.server.daemon_threads = True
        self.origin = f'http://127.0.0.1:{self.server.server_port}'
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        assert not self.thread.is_alive(), 'Auth fixture listener failed to stop'

    def snapshot(self):
        with self.lock:
            return {'events': list(self.events), 'tokens_issued': sum(c['used'] for c in self.codes.values()),
                    'device_tokens_issued': sum(event['kind'] == 'device_token' for event in self.events)}

    def handler(self):
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def webkit_fixture(self):
                return any(marker in self.headers.get('User-Agent', '')
                           for marker in ('NACExternalAuthWK/', 'NACDeviceAuthWK/'))

            def reply(self, status, body, content_type='application/json'):
                data = (json.dumps(body) if content_type == 'application/json' else body).encode()
                self.send_response(status)
                self.send_header('Content-Type', content_type)
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Connection', 'close')
                self.end_headers()
                self.wfile.write(data)

            def event(self, kind, **values):
                # Explicit allowlisted metadata only; never stringify a request.
                with fixture.lock:
                    fixture.events.append({'kind': kind, **values})

            def do_GET(self):
                parts = urlsplit(self.path)
                query = parse_qs(parts.query)
                if parts.path == '/evidence':
                    return self.reply(200, fixture.snapshot())
                if parts.path.startswith('/oauth/authorize/'):
                    mode = parts.path.rsplit('/', 1)[-1]
                    one = lambda key: query.get(key, [''])[0]
                    if (mode not in ('success', 'denied', 'wrong-state', 'hold') or
                            one('redirect_uri') != fixture.callback or one('response_type') != 'code' or
                            one('code_challenge_method') != 'S256' or not one('code_challenge') or
                            not one('state') or not one('client_id')):
                        return self.reply(400, {'error': 'invalid_request'})
                    code = secrets.token_urlsafe(24)
                    with fixture.lock:
                        fixture.codes[code] = {'challenge': one('code_challenge'), 'client': one('client_id'),
                                               'expires': fixture.clock() + 60, 'used': False}
                    self.event('authorization', mode=mode,
                               webkit_fixture=self.webkit_fixture())
                    callback = fixture.callback + '?' + urlencode(
                        {'error': 'access_denied', 'state': one('state')} if mode == 'denied' else
                        {'code': code, 'state': 'wrong-fixture-state' if mode == 'wrong-state' else one('state')})
                    # Observe the real external page before returning to Rust's
                    # callback. This is not a shell opener replacement.
                    script = r"""
                    fetch('/browser-observation', {method:'POST', headers:{'Content-Type':'application/json'},
                      body:JSON.stringify({bridge:typeof window.__nacDesktop !== 'undefined',
                        wkFixture:/NAC(?:External|Device)AuthWK\//.test(navigator.userAgent)})})
                      .then(() => { CALLBACK });
                    """.replace('CALLBACK', '' if mode == 'hold' else f'location.replace({json.dumps(callback)})')
                    return self.reply(200, '<!doctype html><title>NAC local auth fixture</title>'
                                      '<p>Local deterministic auth fixture. Return to NAC.</p>'
                                      f'<script>{script}</script>', 'text/html; charset=utf-8')
                if parts.path == '/device/verify':
                    code = query.get('user_code', [''])[0]
                    with fixture.lock:
                        device = fixture.devices.get(code)
                        if device and device['expires'] > fixture.clock() and device['mode'] not in ('hold', 'timeout'):
                            device['approved'] = True
                    if not device:
                        return self.reply(400, {'error': 'invalid_request'})
                    self.event('device_browser', webkit_fixture=self.webkit_fixture())
                    return self.reply(200, '<!doctype html><title>NAC device fixture</title><p>Approved. Return to NAC.</p>'
                                      "<script>fetch('/browser-observation',{method:'POST',body:JSON.stringify({"
                                      "bridge:typeof window.__nacDesktop!=='undefined',"
                                      "wkFixture:/NAC(?:External|Device)AuthWK\\//.test(navigator.userAgent)})})</script>",
                                      'text/html; charset=utf-8')
                self.reply(404, {'error': 'not_found'})

            def do_POST(self):
                try:
                    length = int(self.headers.get('Content-Length', '0'))
                    if not 0 <= length <= 8192:
                        return self.reply(400, {'error': 'invalid_request'})
                    data = self.rfile.read(length)
                    path = urlsplit(self.path).path
                    if path == '/browser-observation':
                        value = json.loads(data)
                        if type(value.get('bridge')) is not bool or type(value.get('wkFixture')) is not bool:
                            return self.reply(400, {'error': 'invalid_request'})
                        self.event('browser_observation', bridge=value['bridge'], webkit_fixture=value['wkFixture'])
                        return self.reply(200, {'observed': True})
                    if self.headers.get('Content-Type', '').startswith('application/json'):
                        value = json.loads(data)
                        if not isinstance(value, dict) or any(not isinstance(item, str) for item in value.values()):
                            return self.reply(400, {'error': 'invalid_request'})
                        form = {key: [item] for key, item in value.items()}
                    else:
                        form = parse_qs(data.decode())
                    one = lambda key: form.get(key, [''])[0]
                    if path == '/oauth/token':
                        digest = base64.urlsafe_b64encode(hashlib.sha256(one('code_verifier').encode()).digest()).rstrip(b'=').decode()
                        with fixture.lock:
                            code = fixture.codes.get(one('code'))
                            valid = (code and not code['used'] and code['expires'] > fixture.clock() and
                                     one('grant_type') == 'authorization_code' and one('redirect_uri') == fixture.callback and
                                     one('client_id') == code['client'] and digest == code['challenge'])
                            if valid:
                                code['used'] = True
                        if not valid:
                            return self.reply(400, {'error': 'invalid_grant'})
                        self.event('token_exchange', pkce_verified=True)
                        return self.reply(200, {'access_token': 'local-fixture-access', 'token_type': 'Bearer',
                                                'expires_in': 3600, 'scope': 'fixture:read'})
                    if path in ('/device/code', '/app/v1/device/code'):
                        if path.startswith('/app/') and one('client_id') != 'nac-cli':
                            return self.reply(400, {'error': 'invalid_client'})
                        code = secrets.token_urlsafe(12)
                        expiry = fixture.device_timeout_seconds if fixture.device_mode == 'timeout' else 60
                        with fixture.lock:
                            fixture.devices[code] = {'approved': False, 'expires': fixture.clock() + expiry, 'mode': fixture.device_mode}
                        self.event('device_started')
                        verification = fixture.origin + '/device/verify?' + urlencode({'user_code': code})
                        return self.reply(200, {'device_code': code, 'user_code': code, 'expires_in': expiry, 'interval': 1,
                                                'verification_uri': verification, 'verification_uri_complete': verification})
                    if path in ('/device/token', '/app/v1/device/token'):
                        if path.startswith('/app/') and one('client_id') != 'nac-cli':
                            return self.reply(400, {'error': 'invalid_client'})
                        with fixture.lock:
                            device = fixture.devices.get(one('device_code'))
                            error = ('expired_token' if not device or device['expires'] <= fixture.clock() else
                                     'authorization_pending' if not device['approved'] else
                                     {'denied': 'access_denied', 'expired': 'expired_token'}.get(device['mode']))
                        if error:
                            return self.reply(400, {'error': error})
                        self.event('device_token')
                        return self.reply(200, {'access_token': 'local-device-access', 'refresh_token': 'local-device-refresh',
                            'token_type': 'Bearer', 'expires_in': 43200, 'base_url': 'https://api.arcee.ai/api/v1',
                            'organization_id': 'local-fixture-org', 'workspace_name': 'local-fixture-workspace'})
                    return self.reply(404, {'error': 'not_found'})
                except (ValueError, UnicodeError):
                    return self.reply(400, {'error': 'invalid_request'})

        return Handler


if __name__ == '__main__':
    with AuthFixture() as auth:
        print(json.dumps({'origin': auth.origin}), flush=True)
        for line in sys.stdin:
            if json.loads(line).get('kind') == 'finish':
                print(json.dumps(auth.snapshot()), flush=True)
                break
