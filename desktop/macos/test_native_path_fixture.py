"""Execute extracted fixture controls; no UI, sandbox, or native-pass claim."""
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SMOKE = ROOT / 'desktop/macos/NativePathSmoke.swift'
JOURNEY = ROOT / 'desktop/macos/NativePathJourney.swift'


class NativePathFixtureTests(unittest.TestCase):
    def test_actual_observer_script_controls(self):
        source = SMOKE.read_text()
        script = re.search(r'private static let observerScript = #"""\n(.*?)\n    """#', source, re.S).group(1)
        harness = r'''
const assert = require('node:assert/strict');
const install = new Function('origin','run','source','app_pid','launch','view','documentID', SCRIPT);
class ElementStub {
  constructor(text='Reveal in Finder', disabled=false) { this.textContent=text; this.disabled=disabled; }
  closest(selector) { assert.equal(selector,'button'); return this; }
}
globalThis.Element = ElementStub;
const args = ['http://127.0.0.1:4321','owned-run','source-sha',123,'launch','view','document'];
function fresh() {
  globalThis.window = {};
  globalThis.location = {origin:args[0], href:args[0]+'/#/session/owned'};
  const handlers=[];
  globalThis.document = {addEventListener:(kind,handler,capture) => {
    assert.equal(kind,'click'); assert.equal(capture,true); handlers.push(handler);
  }};
  return {handlers, click:(trusted=true,target=new ElementStub()) => handlers.forEach(h=>h({isTrusted:trusted,target}))};
}
let state=fresh();
let first=install(...args);
assert.equal(first.count,0); assert.equal(first.installed,true); assert.equal(first.current_document,true);
assert.equal(first.document,'document'); assert.equal(first.run,'owned-run'); assert.equal(first.event,null);
let descriptor=Object.getOwnPropertyDescriptor(window,'__nac347Fixture');
assert.equal(descriptor.writable,false); assert.equal(descriptor.configurable,false);
assert.throws(()=>install(...args), /already installed/); assert.equal(state.handlers.length,1);
state.click(false); state.click(true,new ElementStub('Other button')); state.click(true,new ElementStub('Reveal in Finder',true));
state.click(true,{}); assert.equal(window.__nac347Fixture().count,0);
state.click();
first=window.__nac347Fixture();
assert.equal(first.count,1); assert.deepEqual(first.event,{sequence:1,run:'owned-run',document:'document',href:location.href});
first.count=99; first.event.sequence=99;
assert.equal(window.__nac347Fixture().count,1); assert.equal(window.__nac347Fixture().event.sequence,1);
state.click(); assert.throws(()=>window.__nac347Fixture(),/Replayed/);
state=fresh(); install(...args); globalThis.document={};
assert.throws(()=>window.__nac347Fixture(),/Stale/);
state=fresh(); install(...args); location.origin='http://127.0.0.1:9999';
assert.throws(()=>window.__nac347Fixture(),/Stale/);
state=fresh(); location.origin='https://unrelated.invalid';
assert.throws(()=>install(...args),/wrong origin/); assert.equal(state.handlers.length,0);
assert.equal(Object.hasOwn(window,'__nac347Fixture'),false);
console.log('Actual observer: trusted/current-document/duplicate-install/replay/read-copy controls passed');
'''.replace('SCRIPT', json.dumps(script), 1)
        subprocess.run(['node', '-e', harness], check=True, cwd=ROOT)

    def test_actual_swift_phase_cursor_and_scope(self):
        source = JOURNEY.read_text()
        # Extract the actual Foundation-only scope/finite-state implementation,
        # omitting only the XCTest wait adapter. No implementation is rewritten.
        types = source[source.index('    struct Scope:'):source.index('    private static func navigatePanel')]
        start = types.index('        func wait(')
        opening = types.index('{', start)
        depth = 1
        end = opening + 1
        while depth:
            depth += (types[end] == '{') - (types[end] == '}')
            end += 1
        types = types[:start] + types[end:]
        checks = r'''
    static func check() throws {
        let run = "11111111-1111-1111-1111-111111111111"
        let doc = "22222222-2222-2222-2222-222222222222"
        let next = "33333333-3333-3333-3333-333333333333"
        var record: [String: Any] = ["version":1,"name":"ready","sequence":0,"run":run,
            "source":String(repeating:"a",count:40),"app_pid":100,"window":5,"engine_pid":101,
            "operation":"select-reload-create-reveal","launch":run,"view":run,"document":doc]
        func phase(_ object: [String: Any]) throws -> Phase {
            try JSONDecoder().decode(Phase.self,from:JSONSerialization.data(withJSONObject:object))
        }
        func scope(_ object: [String: Any]) throws -> Scope {
            try JSONDecoder().decode(Scope.self,from:JSONSerialization.data(withJSONObject:object))
        }
        func rejects(_ body: () throws -> Void) throws {
            do { try body() } catch { return }
            throw NSError(domain:"PhaseTest",code:1,userInfo:[NSLocalizedDescriptionKey:"Invalid transition accepted"])
        }
        let expected = try scope(record)
        let folder = URL(fileURLWithPath:"/tmp/owned/Folder with spaces 日本語 " + run)
        try validate(expected,initialPath:"/tmp/owned",folder:folder,operation:"select-reload-create-reveal")
        try rejects { try validate(expected,initialPath:"/tmp/other",folder:folder,operation:"select-reload-create-reveal") }
        try rejects { try validate(expected,initialPath:"/tmp/owned",folder:folder,operation:"pending-engine-failure") }
        let cursor = PhaseCursor(expected)
        _ = try cursor.accept(phase(record)); _ = try cursor.accept(phase(record))
        for key in ["run","source","launch","view","document","operation"] {
            var bad=record; bad[key]="foreign"
            try rejects { _ = try PhaseCursor(expected).accept(phase(bad)) }
        }
        for key in ["app_pid","window","engine_pid","version"] {
            var bad=record; bad[key]=999
            try rejects { _ = try PhaseCursor(expected).accept(phase(bad)) }
        }
        var skipped=record; skipped["name"]="folder-moved"; skipped["sequence"]=2
        try rejects { _ = try cursor.accept(phase(skipped)) }
        let original=record
        record["name"]="document-reloaded"; record["sequence"]=1
        try rejects { _ = try cursor.accept(phase(record)) } // Same document is not a reload.
        record["document"]=next
        _ = try cursor.accept(phase(record)); _ = try cursor.accept(phase(record))
        try rejects { _ = try cursor.accept(phase(original)) } // Backward/stale read.
        var changed=record; changed["document"]=run
        try rejects { _ = try cursor.accept(phase(changed)) } // Changed record at one sequence.
        for (index,name) in [(2,"folder-moved"),(3,"folder-restored"),(4,"reveal-observed")] {
            record["sequence"]=index; record["name"]=name
            if index==2 {
                var retired=record; retired["document"]=doc
                try rejects { _ = try cursor.accept(phase(retired)) }
            }
            _ = try cursor.accept(phase(record))
        }
        var failure=original; failure["operation"]="pending-engine-failure"
        let failureCursor=PhaseCursor(try scope(failure))
        _ = try failureCursor.accept(phase(failure))
        failure["sequence"]=1; failure["name"]="document-reloaded"; failure["document"]=next
        try rejects { _ = try failureCursor.accept(phase(failure)) }
        failure["name"]="failure-panel-observed"; failure["document"]=doc
        _ = try failureCursor.accept(phase(failure))
        var unknown=original; unknown["operation"]="arbitrary-command"
        try rejects { _ = try PhaseCursor(scope(unknown)).accept(phase(unknown)) }
        print("Actual Swift scope/cursor: bindings, exact reload, finite order, stale/skipped/changed records passed")
    }
'''
        program = 'import Foundation\n@MainActor enum NativePathJourney {\n' + types + checks + '\n}\n@main struct Main { @MainActor static func main() throws { try NativePathJourney.check() } }\n'
        with tempfile.TemporaryDirectory(prefix='nac347-phase-controls-') as temp:
            source_path = Path(temp) / 'PhaseControls.swift'
            binary = Path(temp) / 'phase-controls'
            source_path.write_text(program)
            subprocess.run(['xcrun', 'swiftc', '-parse-as-library', '-swift-version', '5', str(source_path), '-o', str(binary)], check=True)
            subprocess.run([str(binary)], check=True)

    def test_source_audit_driver_has_no_filesystem_controls(self):
        source = JOURNEY.read_text()
        self.assertNotRegex(source, r'FileManager|\.write\(to:|contentsOf:|moveItem|Process\(')
        self.assertNotIn('all347-reload-request', source)
        self.assertEqual(source.count('observePhase: @escaping () throws -> Phase'), 2)
        self.assertNotRegex(source, r'observePhase[^\n]*=')

    def test_source_audit_observer_guard_and_mode_ownership(self):
        source = SMOKE.read_text()
        self.assertTrue(source.startswith('#if PREVIEW_SMOKE && !LOCAL_APP'))
        guarded = source[source.index('    private func script('):source.index('    private func projectForm(')]
        self.assertEqual(guarded.count('try requireCurrent(scope, binding)'), 2)
        self.assertIn('app.commands.currentDocument(in: app.webView) == binding', source)
        self.assertIn('app.engine.receipt?.identity == scope.identity', source)
        self.assertIn('app.failure == nil', source)
        self.assertNotIn('all347-xctest-complete', source)
        self.assertNotIn('all347-engine-failure-request', source)


if __name__ == '__main__':
    unittest.main()
