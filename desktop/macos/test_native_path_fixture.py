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
  globalThis.location = {origin:args[0], href:args[0]+'/#/session/owned/chat'};
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
assert.equal(first.href,location.href);
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
state=fresh(); install(...args); state.click(); location.href=args[0]+'/#/session/foreign';
assert.throws(()=>window.__nac347Fixture(),/Stale reveal route/);
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

    def test_actual_form_script_controls(self):
        source = SMOKE.read_text()
        script = re.search(r'private static let formScript = #"""\n(.*?)\n        """#', source, re.S).group(1)
        harness = r"""
const assert = require('node:assert/strict');
const inspect = new Function('folderLeaf', SCRIPT);
const leaf='Folder with spaces 日本語 owned-run';
const raw='/tmp/owned/'+leaf, physical='/private/tmp/owned/'+leaf;
const button=(label,text,enabled=true,visible=true)=>({
  textContent:text, disabled:!enabled, getAttribute:()=>label,
  getClientRects:()=>visible?[{}]:[]
});
let buttons=[], errors=[];
globalThis.document={querySelectorAll:selector=>selector==='button'?buttons:errors};
const error=(text,visible=true)=>({textContent:text,getClientRects:()=>visible?[{}]:[]});
for(const path of [raw,physical]) {
  buttons=[button('Choose Working Folder: '+path,'folder'),button(null,'Create Project')];
  errors=[];
  assert.deepEqual(inspect(leaf),{path,can_create:true,missing:false});
  errors=[error('/different/spelling/'+leaf+' does not exist')];
  buttons[1].disabled=true;
  assert.deepEqual(inspect(leaf),{path,can_create:false,missing:true});
  errors=[error('Other folder does not exist'),error(leaf+' does not exist',false)];
  assert.equal(inspect(leaf).missing,false);
  errors=[error(leaf),error('does not exist')];
  assert.equal(inspect(leaf).missing,false);
}
buttons.push(button('Choose Working Folder: '+raw,'second form'));
assert.throws(()=>inspect(leaf),/Ambiguous/);
console.log('Actual form observer preserves observed path spelling, unique error leaf and ambiguity rejection');
""".replace('SCRIPT', json.dumps(script), 1)
        subprocess.run(['node', '-e', harness], check=True, cwd=ROOT)

    def test_actual_swift_path_and_route_predicates(self):
        smoke, journey = SMOKE.read_text(), JOURNEY.read_text()

        def block(source, marker):
            start = source.index(marker)
            opening = source.index('{', start)
            end, depth = opening + 1, 1
            while depth:
                depth += (source[end] == '{') - (source[end] == '}')
                end += 1
            return source[start:end]

        types = '\n'.join(block(smoke, name) for name in
                          ['    private struct RevealEvent:', '    private struct ProjectForm:',
                           '    private struct RevealObservation:'])
        label = block(journey, '    private static func selectedFolderLabel(')
        checks = r"""
    static func check() throws {
        let values=CommandLine.arguments
        let raw=values[1], physical=values[2], foreign=values[3]
        let folder=URL(fileURLWithPath:raw)
        func resolve(_ path: String) -> String? {
            guard let value=realpath(path,nil) else { return nil }
            defer { free(value) }; return String(cString:value)
        }
        func require(_ condition: Bool) throws {
            if !condition { throw NSError(domain:"FixturePredicates",code:1) }
        }
        try require(raw != physical && resolve(raw)==physical)
        for path in [raw,physical] {
            let form=ProjectForm(path:path,can_create:true,missing:false)
            try require(form.selectedFolder(root:physical,resolve:resolve)==path)
            try require(selectedFolderLabel("Choose Working Folder: "+path,folder:folder))
            let missing=ProjectForm(path:path,can_create:false,missing:true)
            try require(missing.rejectedFolder(previousPath:path))
            try require(!missing.rejectedFolder(previousPath:foreign))
        }
        try require(selectedFolderLabel("Choose Working Folder: "+foreign,folder:folder))
        try require(ProjectForm(path:foreign,can_create:true,missing:false).selectedFolder(root:physical,resolve:resolve)==nil)
        try require(ProjectForm(path:raw,can_create:false,missing:false).selectedFolder(root:physical,resolve:resolve)==nil)
        try require(!selectedFolderLabel("Choose Working Folder: relative",folder:folder))
        try require(!selectedFolderLabel("Choose Working Folder: /other-leaf",folder:folder))
        let origin="http://127.0.0.1:4321", href=origin+"/#/session/current/chat"
        var record:[String:Any] = ["version":1,"run":"run","source":"source","app_pid":10,
            "launch":"launch","view":"view","document":"document","origin":origin,"href":href,
            "installed":true,"current_document":true,"count":1,
            "event":["sequence":1,"run":"run","document":"document","href":href]]
        func observation(_ value:[String:Any]) throws -> RevealObservation {
            try JSONDecoder().decode(RevealObservation.self,from:JSONSerialization.data(withJSONObject:value))
        }
        try require(try observation(record).routeIsCurrent(origin:origin))
        for badHref in [origin+"/#/session/other","http://127.0.0.1:9999/#/session/current",
                        "http://user@127.0.0.1:4321/#/session/current",origin+"/#/projects"] {
            var wrong=record; wrong["href"]=badHref
            try require(try !observation(wrong).routeIsCurrent(origin:origin))
        }
        for (key,value) in [("run","foreign"),("document","foreign"),("href",origin+"/#/session/old")] {
            var wrong=record; var event=record["event"] as! [String:Any];event[key]=value;wrong["event"]=event
            try require(try !observation(wrong).routeIsCurrent(origin:origin))
        }
        var replay=record;replay["count"]=2
        try require(try !observation(replay).routeIsCurrent(origin:origin))
        record["count"]=0;record["event"]=NSNull()
        try require(try observation(record).routeIsCurrent(origin:origin))
        print("Actual Swift predicates: canonical aliases accepted, foreign same-leaf root rejected, captured/current JS route and origin strict")
    }
"""
        program='import Foundation\nimport Darwin\nenum FixtureControls {\n'+types+'\n'+label+'\n'+checks+'\n}\n@main struct Main { static func main() throws { try FixtureControls.check() } }\n'
        with tempfile.TemporaryDirectory(prefix='nac347-alias-controls-', dir='/tmp') as temp:
            parent=Path(temp)
            folder=parent/'Folder with spaces 日本語 owned-run'
            folder.mkdir()
            foreign=parent/'foreign'/folder.name
            foreign.mkdir(parents=True)
            source_path=parent/'Predicates.swift'
            binary=parent/'predicates'
            source_path.write_text(program)
            subprocess.run(['xcrun','swiftc','-parse-as-library','-swift-version','5',str(source_path),'-o',str(binary)],check=True)
            subprocess.run([str(binary),str(folder),str(folder.resolve()),str(foreign)],check=True)

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
