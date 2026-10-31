"""Execute the verbatim page-world script; no AppKit or OS-input claim."""

import json
from pathlib import Path
import re
import subprocess
import unittest


DRIVER = r"""
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {source, scenario} = JSON.parse(fs.readFileSync(0, 'utf8'));
const receipts = [];
const handler = {postMessage: value => receipts.push(JSON.parse(value))};
const window = {webkit: {messageHandlers: {nacUIReceipt: handler}}};
window.top = window;
const context = vm.createContext({window, assert, receipts, handler});
vm.runInContext(source, context, {timeout: 1000});
vm.runInContext(`
  const port = window.__nacDesktop;
  const binding = {launch: 'launch', view: 'view', document: 'document'};
  const request = {version: 1, request: 1, action: 'settings'};
  let calls = 0;
  const callback = () => { calls++; return true; };
  const disconnect = port.connect(callback);
  assert.equal(port.activate(binding), true);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].kind, 'ready');
` + scenario, context, {timeout: 1000});
"""


class NativeCommandScriptTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        swift = Path(__file__).with_name('NativeCommandScript.swift').read_text()
        scripts = re.findall(r'static let source = #"""\n(.*?)\n    """#', swift, re.S)
        if len(scripts) != 1:
            raise AssertionError('Expected exactly one embedded native command script')
        cls.source = scripts[0]

    def run_script(self, scenario):
        result = subprocess.run(
            ['node', '-e', DRIVER], input=json.dumps({'source': self.source, 'scenario': scenario}),
            text=True, capture_output=True, timeout=10, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_native_retirement_without_handler_is_terminal(self):
        self.run_script("""
          delete window.webkit.messageHandlers.nacUIReceipt;
          port.retire(binding);
          port.retire(binding);
          disconnect();
          assert.equal(port.dispatch(binding, request), false);
          assert.equal(calls, 0);
          assert.equal(port.activate(binding), false);
          assert.throws(() => port.connect(callback), /UI owner unavailable/);
        """)

    def test_native_retirement_never_notifies_or_reenters_removed_owner(self):
        self.run_script("""
          let notifications = 0;
          handler.postMessage = () => {
            notifications++;
            port.dispatch(binding, request);
            throw new Error('handler unavailable');
          };
          port.retire(binding);
          port.retire(binding);
          assert.equal(notifications, 0);
          assert.equal(port.dispatch(binding, request), false);
          assert.equal(calls, 0);
        """)

    def test_unregister_clears_owner_even_if_handler_is_removed_or_throws(self):
        for failure in [
            'delete window.webkit.messageHandlers.nacUIReceipt;',
            "handler.postMessage = () => { throw new Error('handler unavailable'); };",
        ]:
            with self.subTest(failure=failure):
                self.run_script(failure + """
                  assert.throws(disconnect);
                  assert.equal(port.dispatch(binding, request), false);
                  assert.equal(calls, 0);
                  disconnect();
                  window.webkit.messageHandlers.nacUIReceipt = {
                    postMessage: value => receipts.push(JSON.parse(value))
                  };
                  const replacement = port.connect(callback);
                  disconnect();
                  assert.equal(port.dispatch(binding, request), true);
                  assert.equal(calls, 1);
                  replacement();
                  assert.equal(receipts.map(value => value.kind).join(','),
                    'ready,ready,settled,retired');
                """)

    def test_valid_unregister_notifies_once_and_same_callback_can_reconnect(self):
        self.run_script("""
          disconnect();
          disconnect();
          assert.equal(port.dispatch(binding, request), false);
          const replacement = port.connect(callback);
          disconnect();
          assert.equal(port.dispatch(binding, request), true);
          assert.equal(calls, 1);
          replacement();
          assert.equal(receipts.map(value => value.kind).join(','),
            'ready,retired,ready,settled,retired');
        """)

    def test_unregister_notification_cannot_dispatch_old_or_clear_reentrant_owner(self):
        self.run_script("""
          const normalPost = handler.postMessage;
          handler.postMessage = value => {
            normalPost(value);
            if (JSON.parse(value).kind !== 'retired') return;
            assert.equal(port.dispatch(binding, request), false);
            port.connect(callback);
          };
          disconnect();
          handler.postMessage = normalPost;
          disconnect();
          assert.equal(port.dispatch(binding, request), true);
          assert.equal(calls, 1);
          assert.equal(receipts.map(value => value.kind).join(','),
            'ready,retired,ready,settled');
        """)

    def test_stale_document_retirement_does_not_retire_current_owner(self):
        self.run_script("""
          port.retire({...binding, document: 'stale'});
          assert.equal(port.dispatch(binding, request), true);
          assert.equal(calls, 1);
          port.retire(binding);
          assert.equal(port.dispatch(binding, {...request, request: 2}), false);
          disconnect();
          assert.equal(calls, 1);
        """)

    def test_readiness_and_settlement_failures_remain_visible(self):
        self.run_script("""
          handler.postMessage = () => { throw new Error('handler unavailable'); };
          assert.throws(() => port.dispatch(binding, request), /handler unavailable/);
          assert.equal(calls, 1);
          assert.throws(disconnect, /handler unavailable/);
          assert.throws(() => port.connect(callback), /handler unavailable/);
        """)


if __name__ == '__main__':
    unittest.main()
