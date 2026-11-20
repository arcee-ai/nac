"""Exercise the actual terminal fixture's Focus setup script without OS input."""
import json
from pathlib import Path
import re
import subprocess
import unittest


class TerminalPanelSetupTests(unittest.TestCase):
    def test_menu_readiness_scoping_and_existing_panel_do_not_create_a_shell(self):
        source = (Path(__file__).parent / 'CITerminal.swift').read_text()
        script = re.search(r'private static let openPanelStep = #"""\n(.*?)\n    """#', source, re.S).group(1)
        harness = r'''
const assert = require('node:assert/strict');
const step = new Function(SCRIPT);
let state;
function fresh(phone = false) {
  state = {panel: false, dialog: false, expanded: false, disabled: false,
           menuClicks: 0, toggleClicks: 0, terminalClicks: 0, shellClicks: 0, rows: []};
  const menu = {
    get disabled() { return state.disabled; },
    getAttribute(name) { assert.equal(name, 'aria-expanded'); return String(state.expanded); },
    click() { state.menuClicks++; state.expanded = true; }
  };
  const toggle = {
    get disabled() { return state.disabled; },
    getAttribute(name) { assert.equal(name, 'aria-pressed'); return String(state.expanded); },
    click() { state.toggleClicks++; state.expanded = true; }
  };
  const panel = {getClientRects: () => state.panel ? [{}] : []};
  const dialog = {querySelectorAll: selector => {
    assert.equal(selector, 'button'); return state.rows;
  }};
  const row = (labels, disabled, click) => ({
    disabled, click, querySelectorAll(selector) {
      assert.equal(selector, 'span'); return labels.map(textContent => ({textContent}));
    }
  });
  const terminal = () => row(['Terminal', '1 running'], false, () => {
    state.terminalClicks++; state.dialog = false; state.expanded = false; state.panel = true;
  });
  state.rows = [row(['Terminal history'], false, () => assert.fail('wrong row')),
                row(['Terminal'], true, () => assert.fail('disabled row')), terminal(),
                row(['New shell'], false, () => { state.shellClicks++; })];
  globalThis.document = {querySelector(selector) {
    if (selector === '[aria-label="Session terminal"]') return state.panel ? panel : null;
    if (selector === '[role="dialog"][aria-label="Session"]') return state.dialog ? dialog : null;
    if (selector === 'button[aria-label="Session panel"]') return phone ? null : toggle;
    if (selector === 'button[aria-label="Open panel"]') return phone ? menu : null;
    assert.fail('unexpected selector: ' + selector);
  }};
}
fresh();
assert.equal(step(), false); assert.equal(state.toggleClicks, 1);
assert.equal(step(), false); assert.equal(state.toggleClicks, 1);
state.panel = true;
assert.equal(step(), true); assert.equal(state.menuClicks, 0);
assert.equal(state.shellClicks, 0);
fresh(); state.disabled = true;
assert.equal(step(), false); assert.equal(state.toggleClicks, 0);
fresh(true);
assert.equal(step(), false); assert.equal(state.menuClicks, 1);
assert.equal(step(), false); assert.equal(state.menuClicks, 1);
state.dialog = true;
assert.equal(step(), false); assert.equal(state.terminalClicks, 1);
assert.equal(step(), true); assert.equal(state.shellClicks, 0);
fresh(true); state.dialog = true; state.expanded = true;
state.rows = [{disabled: true, querySelectorAll: () => [{textContent: 'Terminal'}],
               click: () => assert.fail('disabled terminal')}];
assert.equal(step(), false); assert.equal(state.menuClicks, 0);
console.log('Focus terminal fixture: delayed menu, exact scoped row, existing panel and disabled controls passed');
'''.replace('SCRIPT', json.dumps(script), 1)
        result = subprocess.run(['node', '-e', harness], capture_output=True, text=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
