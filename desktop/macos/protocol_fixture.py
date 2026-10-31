#!/usr/bin/env python3
"""Smoke-only adversarial child. Never included in the ordinary application."""
import json
import os
from pathlib import Path
import socket
import sys
import time

scenario = Path(__file__).with_name('fixture-scenario').read_text().strip()
channel = socket.socket(fileno=int(os.environ.pop('NAC_DESKTOP_CHANNEL_FD')))
hello = json.loads(channel.makefile('rb').readline(16385))
ready = dict(kind='ready', version=1, incarnation=hello['incarnation'],
             endpoint='http://127.0.0.1:9876', identity=hello['identity'],
             store=hello['store'], schema=1)
if scenario == 'wrong-version':
    ready['version'] = 2
elif scenario == 'wrong-build':
    ready['identity']['build_id'] += '-wrong'
elif scenario == 'wrong-source':
    ready['identity']['source_revision'] = 'wrong'
elif scenario == 'wrong-track':
    ready['identity']['track'] = 'stable'
elif scenario == 'wrong-store':
    ready['store'] += '-wrong'
elif scenario == 'wrong-incarnation':
    ready['incarnation'] = '00000000-0000-0000-0000-000000000000'
elif scenario == 'wrong-endpoint':
    ready['endpoint'] = 'http://example.test:3210'
record = json.dumps(ready).encode() + b'\n'
if scenario == 'malformed':
    record = b'{broken}\n'
elif scenario == 'truncated':
    record = record[:-2]
elif scenario == 'duplicate':
    record *= 2
elif scenario == 'oversized':
    record = b'x' * 16385
elif scenario == 'missing-receipt':
    record = b''
channel.sendall(record)
if scenario == 'truncated':
    channel.shutdown(socket.SHUT_WR)
# Remain alive until the shell rejects the receipt and sends bounded stop.
channel.settimeout(65)
channel.recv(16384)
