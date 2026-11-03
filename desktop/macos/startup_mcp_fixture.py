#!/usr/bin/env python3
"""Disposable stdio MCP server for actual-app command-PATH qualification."""
import json
import sys

for line in sys.stdin:
    request = json.loads(line)
    if 'id' not in request:
        continue
    method = request.get('method')
    if method == 'initialize':
        result = {'protocolVersion': request['params']['protocolVersion'],
                  'capabilities': {'tools': {}}, 'serverInfo': {'name': 'Finder PATH fixture', 'version': '1'}}
    elif method == 'tools/list':
        result = {'tools': [{'name': 'finder_ping', 'description': 'Read-only fixture ping',
                             'inputSchema': {'type': 'object', 'properties': {}}}]}
    elif method == 'tools/call':
        result = {'content': [{'type': 'text', 'text': 'finder PATH fixture'}]}
    else:
        result = {}
    print(json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': result}), flush=True)
