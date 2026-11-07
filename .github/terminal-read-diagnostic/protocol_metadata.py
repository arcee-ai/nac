"""Memory-only Playwright protocol filtering; never persist the raw input."""
import json
import math
import re
import time
from urllib.parse import urlsplit

COMMANDS = {'Fetch.enable', 'Fetch.disable', 'Fetch.continueRequest',
            'Fetch.continueResponse', 'Fetch.failRequest', 'Fetch.fulfillRequest',
            'Network.enable', 'Network.disable'}
EVENTS = {'Fetch.requestPaused', 'Network.requestWillBeSent',
          'Network.responseReceived', 'Network.loadingFinished', 'Network.loadingFailed'}
ID = re.compile(r'[A-Za-z0-9_.:-]{1,128}')
ROUTE = re.compile(r'/sessions/[^/]+/(?:executions(?:/[^/]+)?|user-terminals/[^/]+)(?:/[^/]+)*')


def scalar_id(value):
    return value if isinstance(value, str) and ID.fullmatch(value) else None


def route(value):
    if not isinstance(value, str):
        return None
    try:
        url = urlsplit(value)
        if (url.scheme != 'http' or url.hostname not in ('127.0.0.1', 'localhost', '::1')
                or url.username is not None or url.password is not None
                or not ROUTE.fullmatch(url.path)):
            return None
        parts = url.path.split('/')
        parts[2] = ':session'
        if len(parts) > 4 and parts[4] != 'history':
            parts[4] = ':entity'
        if 'observers' in parts:
            index = parts.index('observers') + 1
            if index < len(parts):
                parts[index] = ':observer'
        # Do not export arbitrary path components, queries or fragments.
        allowed = {'', 'sessions', ':session', 'executions', 'user-terminals', ':entity',
                   'history', 'observers', ':observer', 'read', 'input', 'input-control',
                   'resize', 'close'}
        if any(part not in allowed for part in parts):
            return None
        return {'port': url.port, 'route': '/'.join(parts)}
    except ValueError:
        return None


class MetadataFilter:
    def __init__(self, sink, event_cap=10000, byte_cap=4 * 1024 * 1024):
        self.sink = sink
        self.event_cap, self.byte_cap = event_cap, byte_cap
        self.commands = {}
        self.counts = dict(protocol=0, emitted=0, bytes=0, malformed=0,
                           ignored=0, capacity_drops=0, command_map_drops=0)

    def line(self, line):
        match = re.search(r'pw:protocol\s+(SEND ►|◀ RECV)\s+(\{.*\})(?:\s+\+[^\s]+)?$', line)
        if not match:
            if 'pw:protocol' in line:
                self.counts['malformed'] += 1
            return
        self.counts['protocol'] += 1
        try:
            message = json.loads(match[2])
            assert isinstance(message, dict)
        except (ValueError, AssertionError):
            self.counts['malformed'] += 1
            return
        direction = 'send' if match[1] == 'SEND ►' else 'receive'
        session = scalar_id(message.get('sessionId'))
        command_id = message.get('id')
        key = (session, command_id) if type(command_id) is int else None
        method = message.get('method')
        if method is not None and not isinstance(method, str):
            self.counts['malformed'] += 1
            return
        if direction == 'send' and method in COMMANDS and key is not None:
            if len(self.commands) >= 1024:
                self.counts['command_map_drops'] += 1
                return
            self.commands[key] = method
        elif direction == 'receive' and key in self.commands:
            method = self.commands.pop(key)
        elif method not in EVENTS:
            self.counts['ignored'] += 1
            return
        if method not in COMMANDS | EVENTS:
            self.counts['ignored'] += 1
            return
        record = dict(observed_monotonic=time.monotonic(), direction=direction,
                      session=session, method=method)
        if key is not None:
            record['command_id'] = command_id
            record['response_error'] = type(message.get('error')) is dict
        params = message.get('params')
        if isinstance(params, dict):
            for name in ('requestId', 'networkId'):
                if (value := scalar_id(params.get(name))) is not None:
                    record[name] = value
            for name in ('timestamp', 'encodedDataLength', 'responseStatusCode'):
                value = params.get(name)
                if type(value) in (int, float) and math.isfinite(value):
                    record[name] = value
            if type(params.get('canceled')) is bool:
                record['canceled'] = params['canceled']
            if re.fullmatch(r'net::ERR_[A-Z_]{1,64}', str(params.get('errorText'))):
                record['network_error'] = params['errorText']
            request, response = params.get('request', {}), params.get('response', {})
            for endpoint in (request, response):
                if isinstance(endpoint, dict) and (normalized := route(endpoint.get('url'))):
                    record.update(normalized)
            if isinstance(request, dict) and request.get('method') in {'GET', 'POST', 'DELETE'}:
                record['http_method'] = request['method']
            if isinstance(response, dict) and type(response.get('status')) is int:
                record['http_status'] = response['status']
        encoded = json.dumps(record, separators=(',', ':')) + '\n'
        size = len(encoded.encode())
        if self.counts['emitted'] >= self.event_cap or self.counts['bytes'] + size > self.byte_cap:
            self.counts['capacity_drops'] += 1
            return
        self.sink.write(encoded)
        self.counts['emitted'] += 1
        self.counts['bytes'] += size
