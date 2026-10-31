"""Execute the exact folder script. No AppKit or trusted OS input claim."""
import json
from pathlib import Path
import re
import subprocess
import unittest


DRIVER = r"""
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const {source, scenario} = JSON.parse(fs.readFileSync(0, 'utf8'));
const messages = [];
const handler = {postMessage: body => messages.push(JSON.parse(body))};
const window = {webkit: {messageHandlers: {nacLocalPaths: handler}}};
window.top = window;
const context = vm.createContext({window, assert, messages, handler, AbortController, TextEncoder});
vm.runInContext(source, context, {timeout: 1000});
vm.runInContext(`(async () => {
  const port = window.__nacLocalPaths;
  const binding = {launch: 'launch', view: 'view', document: 'document'};
  assert.equal(port.activate(binding), true);
` + scenario + '\n})()', context, {timeout: 1000}).catch(error => { console.error(error); process.exitCode = 1; });
"""


class NativePathScriptTests(unittest.TestCase):
    def run_script(self, scenario):
        swift = Path(__file__).with_name('NativePathScript.swift').read_text()
        sources = re.findall(r'static let source = #"""\n(.*?)\n    """#', swift, re.S)
        self.assertEqual(len(sources), 1)
        result = subprocess.run(
            ['node', '-e', DRIVER], input=json.dumps({'source': sources[0], 'scenario': scenario}),
            text=True, capture_output=True, timeout=10, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_exact_selection_once_and_stale_binding_rejected(self):
        self.run_script("""
          const result = port.chooseDirectory('/tmp/日本語 space', new AbortController().signal);
          const request = messages[0];
          assert.equal(request.kind, 'choose');
          assert.equal(request.initialPath, '/tmp/日本語 space');
          assert.equal(port.settle({...binding, document: 'old'}, request.request, '/wrong', false), false);
          assert.equal(port.settle(binding, request.request + 1, '/wrong', false), false);
          assert.equal(port.settle(binding, request.request, '/tmp/🦀 space', false), true);
          assert.equal(port.settle(binding, request.request, '/duplicate', false), false);
          assert.equal(await result, '/tmp/🦀 space');
        """)

    def test_abort_and_supersede_cannot_settle_successor(self):
        self.run_script("""
          const controller = new AbortController();
          const first = port.chooseDirectory('/first', controller.signal);
          const second = port.chooseDirectory('/second', new AbortController().signal);
          assert.equal(await first, null);
          assert.equal(messages[1].kind, 'cancel');
          controller.abort();
          assert.equal(port.settle(binding, 1, '/stale', false), false);
          assert.equal(port.settle(binding, 2, '/current', false), true);
          assert.equal(await second, '/current');
          const thirdController = new AbortController();
          const third = port.chooseDirectory('/third', thirdController.signal);
          thirdController.abort();
          assert.equal(await third, null);
          assert.equal(messages.at(-1).kind, 'cancel');
          assert.equal(port.settle(binding, 3, '/late', false), false);
        """)

    def test_retirement_is_local_terminal_and_handler_independent(self):
        self.run_script("""
          const result = port.chooseDirectory('', new AbortController().signal);
          port.retire({...binding, document: 'old'});
          delete window.webkit.messageHandlers.nacLocalPaths;
          port.retire(binding);
          port.retire(binding);
          assert.equal(await result, null);
          assert.equal(port.activate(binding), false);
          await assert.rejects(port.chooseDirectory('', new AbortController().signal), /unavailable/);
          assert.equal(port.settle(binding, 1, '/late', false), false);
          assert.equal(messages.length, 1);
        """)

    def test_handler_failure_and_native_failure_never_retry(self):
        self.run_script("""
          const result = port.chooseDirectory('', new AbortController().signal);
          assert.equal(port.settle(binding, 1, null, true), true);
          await assert.rejects(result, /unavailable/);
          handler.postMessage = () => { throw new Error('gone'); };
          await assert.rejects(port.chooseDirectory('', new AbortController().signal), /gone/);
          assert.equal(messages.length, 1);
        """)


if __name__ == '__main__':
    unittest.main()
