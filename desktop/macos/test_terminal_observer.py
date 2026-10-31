"""Content-free fixture observation; these mocks never qualify WK or input."""
import json
import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest


class TerminalObserverTests(unittest.TestCase):
    def diagnostic_case(self, body):
        fixture = Path(__file__).with_name('TerminalFixture.swift')
        observer = fixture.read_text().split('static let observer = #"""', 1)[1].split('"""#', 1)[0]
        module = Path(__file__).resolve().parents[2] / 'crates/nac-server/web/node_modules/jsdom'
        script = r"""
const {observer,module,body}=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
const {JSDOM}=require(module), assert=require('node:assert/strict');
const flush=async()=>{for(let i=0;i<12;i++) await new Promise(resolve=>setImmediate(resolve));};
function fixture() {
 const dom=new JSDOM('<div data-nac-runtime="1"><textarea class="xterm-helper-textarea"></textarea></div>',
   {url:'http://127.0.0.1/#/session/session/terminal',runScripts:'outside-only'});
 const w=dom.window, handlers={}, calls=[];
 Object.assign(w,{TextDecoder,TextEncoder,Response});
 const listen=w.document.addEventListener.bind(w.document);
 w.document.addEventListener=(type,handler,...rest)=>{handlers[type]=handler;listen(type,handler,...rest);};
 let implementation=()=>Promise.resolve(Response.json({outcome:'written'}));
 const original=function(...args){calls.push({receiver:this,args});return implementation(...args);};
 w.fetch=original;
 w.Function(observer)();
 const textarea=w.document.querySelector('textarea'),root=textarea.parentElement;
 textarea.focus();
 const begin=(sequence=1,reference=[65],extra={})=>w.__terminal352Diagnostics.begin({
   name:'unicode',sequence,episode:'11111111-1111-4111-8111-111111111111',
   session:'session',terminal:'terminal',revision:'1',reference,...extra});
 const options=bytes=>({method:'POST',body:JSON.stringify({bytes,expected_revision:'1'})});
 const path='/sessions/session/executions/terminal/input';
 return {w,dom,textarea,root,handlers,calls,begin,options,path,
   snapshot:()=>w.__terminal352Diagnostics.snapshot(true),
   implementation:run=>{implementation=run;},install:()=>w.Function(observer)()};
}
(async()=>{const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
 await new AsyncFunction('fixture','assert','flush','Response','TextEncoder',body)(fixture,assert,flush,Response,TextEncoder);
 console.log(JSON.stringify({passed:true}));})().catch(error=>{console.error(error);process.exitCode=1;});
"""
        result = subprocess.run(['node', '-e', script], input=json.dumps({
            'observer': observer, 'module': str(module), 'body': body}),
            capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {'passed': True})

    def native_evidence(self):
        source = Path(__file__).with_name('TerminalFixture.swift')
        main = r'''
import Foundation
let identity = ["episode_id":"11111111-1111-4111-8111-111111111111", "phase_sequence":"1"]
func model(_ seconds: Double = 60, _ id: [String:String] = identity) -> TerminalFixture.PhaseEvidence {
    TerminalFixture.PhaseEvidence(identity:id,whole:(100,102),phase:(200,202),seconds:seconds,
        wallDeadline:Date(timeIntervalSince1970:500),wholeDeadline:Date(timeIntervalSince1970:700))
}
let sample: [String:Any] = ["document_id":"22222222-2222-4222-8222-222222222222",
 "runtime_id":"1","root_token":1,"textarea_token":2,"phase_sequence":1,
 "inputPosts":1,"inputBytes":1,"inputSettled":0,"capture_complete":true,
 "headers":"PRIVATE-CREDENTIAL","events":[["type":"input","trusted":true,"data":"PRIVATE-KEY"]]]
let failed=model()
failed.observe(sample,begin:210,end:220,baseline:true)
failed.predicate("controller","sampling")
failed.file("unicode",nil)
_ = failed.snapshot(state:"ready",stage:"ready-emission",now:230)
failed.readyReturned(240)
let failure=failed.snapshot(state:"failed",stage:"deadline",now:300,seal:true)
failed.file("unicode",Data(TerminalFixture.unicode.utf8))
failed.observe(["inputPosts":999],begin:310,end:320)
let stillFailed=failed.snapshot(state:"verified",stage:"complete",now:330,seal:true)
let retired=model()
retired.observe(sample,begin:210,end:220,baseline:true)
var other=sample;other["runtime_id"]="2";other["inputPosts"]=999
retired.observe(other,begin:250,end:260)
let mismatch=model();mismatch.file("unicode",Data("PRIVATE-WRONG-FILE".utf8))
let oversized=model(60,["oversized":String(repeating:"x",count:70000)])
let output: [String:Any] = ["failure":failure,"stillFailed":stillFailed,
 "retired":retired.snapshot(state:"failed",stage:"target",now:300),
 "mismatch":mismatch.snapshot(state:"failed",stage:"proof",now:300),
 "interrupt":model(10).snapshot(state:"ready",stage:"ready-emission",now:230),
 "bounded":oversized.snapshot(state:"failed",stage:"target",now:300,seal:true),
 "unicode_reference":TerminalFixture.inputReference(command:TerminalFixture.unicodeCommand,expectedBytes:121),
 "interrupt_reference":TerminalFixture.inputReference(command:nil,expectedBytes:1),
 "resize_reference":TerminalFixture.inputReference(command:nil,expectedBytes:0)]
print(String(decoding:try JSONSerialization.data(withJSONObject:output,options:[.sortedKeys]),as:UTF8.self))
'''
        with tempfile.TemporaryDirectory(prefix='nac352-source-test-') as temp:
            directory = Path(temp)
            (directory / 'main.swift').write_text(main)
            executable = directory / 'evidence-source-test'
            build = subprocess.run(['xcrun', 'swiftc', '-swift-version', '5',
                '-D', 'PREVIEW_SMOKE', '-D', 'TERMINAL_SMOKE', str(source),
                str(directory / 'main.swift'), '-o', str(executable)],
                capture_output=True, text=True, timeout=90)
            self.assertEqual(build.returncode, 0, build.stderr)
            result = subprocess.run([str(executable)], capture_output=True, text=True, check=True, timeout=10)
            self.assertNotIn('PRIVATE', result.stdout)
            for flags in ([], ['-D', 'PREVIEW_SMOKE']):
                (directory / 'main.swift').write_text('import Foundation\n')
                control = subprocess.run(['xcrun', 'swiftc', '-swift-version', '5', *flags,
                    str(source), str(directory / 'main.swift'), '-o', str(executable)],
                    capture_output=True, text=True, timeout=90)
                self.assertEqual(control.returncode, 0, control.stderr)
                for marker in (b'__terminal352', b'ready_record_return_ns', b'WK-XCTEST-UNICODE'):
                    self.assertNotIn(marker, executable.read_bytes())
            return json.loads(result.stdout)

    def test_timeout_predicates_and_immutable_native_failure(self):
        data = self.native_evidence()
        self.assertEqual(data['failure'], data['stillFailed'])
        self.assertEqual(data['failure']['state'], 'failed')
        self.assertEqual(data['failure']['predicates']['file_unicode'], 'absent')
        self.assertEqual(data['failure']['predicates']['controller'], 'unavailable')
        self.assertEqual(data['mismatch']['predicates']['file_unicode'], 'mismatch')
        self.assertEqual(data['retired']['last']['inputPosts'], 1)
        self.assertTrue(data['retired']['last']['retired'])
        self.assertEqual(data['retired']['sample_age_ns'], '80')

    def test_native_clock_cap_truth_and_serialization_bound(self):
        data = self.native_evidence()
        value = data['failure']
        self.assertEqual(value['timing']['seconds_limit'], 60)
        self.assertEqual(value['timing']['phase_nominal_deadline_ns'], '60000000202')
        self.assertEqual(value['timing']['whole_nominal_deadline_ns'], '240000000102')
        self.assertEqual(data['interrupt']['timing']['phase_nominal_deadline_ns'], '10000000202')
        self.assertEqual(value['timing']['wall_deadline_epoch_ms'], 500000)
        self.assertEqual(value['ready_emit_ns'], '230')
        self.assertEqual(value['ready_callback_interval_ns'], '10')
        self.assertEqual(value['writer_durable_time'], 'unknown')
        self.assertEqual(value['driver_observed_ready_time'], 'unknown')
        self.assertEqual(data['bounded']['diagnostic_error'], 'snapshot-bound-or-serialization')
        self.assertLess(len(json.dumps(data['bounded'])), 65536)
        self.assertEqual(len(data['unicode_reference']), 121)
        self.assertEqual(hashlib.sha256(bytes(data['unicode_reference'])).hexdigest(),
                         '68f6c221b9f08f07842942a6590422ba1d1ad553dc228cea0ac0a93554f745ef')
        self.assertEqual(data['unicode_reference'][-1], 13)
        self.assertEqual(data['interrupt_reference'], [3])
        self.assertEqual(data['resize_reference'], [])

    def test_retired_document_runtime_phase_and_late_callbacks(self):
        self.diagnostic_case(r'''
const f=fixture();assert.equal(f.begin(),true);
let resolve;f.implementation(()=>new Promise(done=>{resolve=done;}));
const pending=f.w.fetch(f.path,f.options([65]));
const before=f.snapshot();assert.equal(before.inflight,1);
f.begin(2,[66]);resolve(Response.json({outcome:'written'}));await pending;await flush();
assert.equal(f.snapshot().written,0);assert.equal(f.snapshot().observed_bytes,0);
assert.equal(f.snapshot().inputWritten,0);assert.equal(f.snapshot().inputPosts,0);
assert.equal(before.requests[0].outcome,'pending');
f.implementation(()=>Promise.resolve(Response.json({outcome:'written'})));
f.root.setAttribute('data-nac-runtime','2');
await f.w.fetch(f.path,f.options([66]));await flush();
assert.equal(f.snapshot().observed_bytes,0);assert.equal(f.snapshot().retired,true);
f.w.dispatchEvent(new f.w.Event('pagehide'));assert.equal(f.begin(3),false);
f.dom.window.close();
const g=fixture();g.begin();let finish;
g.implementation(()=>new Promise(done=>{finish=done;}));const old=g.w.fetch(g.path,g.options([65]));
g.install();g.begin(1,[66]);finish(Response.json({outcome:'written'}));await old;await flush();
assert.equal(g.snapshot().written,0);assert.equal(g.snapshot().observed_bytes,0);
g.dom.window.close();
const h=fixture();h.begin();h.textarea.replaceWith(h.textarea.cloneNode());
assert.equal(h.begin(2),false);assert.equal(h.snapshot().capture_complete,false);h.dom.window.close();
''')

    def test_fetch_identity_error_and_trust_noninterference(self):
        self.diagnostic_case(r'''
const f=fixture();f.begin();const response=Response.json({outcome:'written'});
const original=Promise.resolve(response);f.implementation(()=>original);
const receiver={};const options=f.options([65]);options.headers={Authorization:'PRIVATE-HEADER'};
options.signal=new AbortController().signal;const result=f.w.fetch.call(receiver,f.path,options);
assert.equal(result,original);assert.equal(await result,response);await flush();
assert.equal(f.calls.length,1);assert.equal(f.calls[0].receiver,receiver);assert.equal(f.calls[0].args[1],options);
const error=new Error('PRIVATE-ERROR');f.implementation(()=>Promise.reject(error));
await assert.rejects(f.w.fetch(f.path,f.options([65])),value=>value===error);await flush();
f.implementation(()=>{throw error;});assert.throws(()=>f.w.fetch(f.path,f.options([65])),value=>value===error);
for(const outcome of ['rejected','uncertain']) {
 f.implementation(()=>Promise.resolve(Response.json({outcome,error:'PRIVATE-RESPONSE'},
   {status:outcome==='rejected'?409:200})));
 await f.w.fetch(f.path,f.options([65]));await flush();
}
assert.equal(f.snapshot().rejected,1);assert.equal(f.snapshot().uncertain,1);
f.implementation(()=>Promise.resolve(Response.json({outcome:'written'})));
await f.w.fetch(new URL('http://127.0.0.1/unfamiliar'),{});
const calls=f.calls.length;
for(const trusted of [false,true]) f.handlers.keydown({type:'keydown',target:f.textarea,isTrusted:trusted,
 isComposing:false,key:'PRIVATE-KEY',data:'PRIVATE-DATA'});
assert.equal(f.calls.length,calls);assert.equal(f.snapshot().events.length,2);
assert.deepEqual(Array.from(f.snapshot().events,e=>e.trusted),[false,true]);
assert.equal(JSON.stringify(f.snapshot()).includes('PRIVATE'),false);f.dom.window.close();
const g=fixture();g.begin();let reads=0;
const accessor={get method(){reads++;return 'POST';},get body(){reads++;return 'PRIVATE';}};
g.implementation((_resource,options)=>{void options.method;return Promise.resolve(response);});
await g.w.fetch(g.path,accessor);assert.equal(reads,1);assert.equal(g.snapshot().inputPosts,0);
g.dom.window.close();
''')

    def test_fixed_utf8_reference_chunking_mismatch_and_privacy(self):
        self.diagnostic_case(r'''
const reference=[...new TextEncoder().encode('Ω中🙂\r')];
for(let split=0;split<=reference.length;split++) {
 const f=fixture();f.begin(1,reference);
 for(const bytes of [reference.slice(0,split),reference.slice(split)]) await f.w.fetch(f.path,f.options(bytes));
 await flush();assert.equal(f.snapshot().reference_exact,true);assert.equal(f.snapshot().prefix_bytes,reference.length);
 f.dom.window.close();
}
const f=fixture();f.begin(1,reference);
const wrong=reference.slice();wrong[3]=0;
await f.w.fetch(f.path,f.options(wrong));await flush();assert.equal(f.snapshot().mismatch_offset,3);
assert.equal(f.snapshot().reference_exact,false);
const marker='WK-XCTEST-UNICODE: Ω中🙂';
f.w.__terminal352.markerReceipts[marker]={observer:'PRIVATE-OBSERVER',cursor:'123',acknowledged:true};
const metadata=f.w.__terminal352Diagnostics.marker(marker);
assert.equal(typeof metadata.observer_token,'number');assert.equal(metadata.cursor,'123');
assert.equal(JSON.stringify(metadata).includes('PRIVATE'),false);
assert.equal('reference' in f.snapshot(),false);assert.equal('bytes' in f.snapshot().requests[0],true);
assert.equal(Array.isArray(f.snapshot().requests[0].bytes),false);f.dom.window.close();
for(const bytes of [reference.slice(0,-1),[...reference,0],[...reference.slice(0,-1),10]]) {
 const g=fixture();g.begin(1,reference);await g.w.fetch(g.path,g.options(bytes));await flush();
 assert.equal(g.snapshot().reference_exact,false);g.dom.window.close();
}
''')

    def test_bounds_observation_failure_and_no_hot_path_io(self):
        self.diagnostic_case(r'''
const f=fixture();f.begin();let writes=0;
f.w.console.log=()=>{writes++;};f.w.console.error=()=>{writes++;};
for(let i=0;i<500;i++) f.handlers.input({type:'input',target:f.textarea,isTrusted:true,
 isComposing:false,data:'PRIVATE-TEXT'});
assert.equal(writes,0);assert.equal(f.calls.length,0);assert.equal(f.snapshot().events.length,128);
assert.equal(f.snapshot().dropped_events,372);assert.equal(f.snapshot().capture_complete,false);
for(let i=0;i<80;i++) await f.w.fetch(f.path,f.options([65]));await flush();
assert.equal(f.calls.length,80);assert.equal(f.snapshot().requests.length,64);
assert.equal(f.snapshot().dropped_requests,16);assert.equal(f.snapshot().written,80);
const before=f.calls.length;f.w.__terminal352Diagnostics.request=()=>{throw Error('PRIVATE-DIAGNOSTIC');};
const response=Response.json({outcome:'written'}), promise=Promise.resolve(response);
f.implementation(()=>promise);assert.equal(f.w.fetch(f.path,f.options([65])),promise);await flush();
assert.equal(f.calls.length,before+1);assert.equal(JSON.stringify(f.w.__terminal352).includes('PRIVATE'),false);
assert.equal(f.snapshot().capture_complete,false);assert.equal(f.snapshot().errors>0,true);
assert.equal(f.begin(2,new Array(4097).fill(65)),false);
assert.equal(f.snapshot().capture_complete,false);
assert.equal(f.w.fetch(f.path,f.options([65])),promise);await flush();
f.dom.window.close();
''')

    def test_responsive_shell_selection_is_scoped_visible_and_once_only(self):
        source = Path(__file__).with_name('TerminalSmoke.swift').read_text()
        controls = source.split('static let shellControls = #"""', 1)[1].split('"""#', 1)[0]
        module = Path(__file__).resolve().parents[2] / 'crates/nac-server/web/node_modules/jsdom'
        script = r"""
const data=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
const {JSDOM}=require(data.module);
const rows=[];
for(const narrow of [false,true]) {
 const dom=new JSDOM(`<button id="outside">New shell</button>
   <section aria-label="Other terminal"><button id="other">New shell</button></section>
   <section aria-label="Session terminal">
     <button hidden>New shell</button><button disabled>New shell</button>
     <div inert><button>New shell</button></div>
     <button title="New shell"></button><button>Retry opening same shell</button>
   </section>`,{runScripts:'outside-only'});
 const w=dom.window, panel=w.document.querySelector('section[aria-label="Session terminal"]');
 w.HTMLElement.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{}];};
 let launches=0, opens=0, decoys=0;
 for(const b of w.document.querySelectorAll('button')) b.onclick=()=>{decoys++;};
 const addLaunch=()=>{
   const b=w.document.createElement('button');b.textContent=narrow?'New Shell':'New shell';
   b.onclick=()=>{launches++;};panel.append(b);
 };
 if(narrow) {
   const b=w.document.createElement('button');b.setAttribute('aria-label','Open list');
   b.onclick=()=>{opens++;b.remove();addLaunch();};panel.append(b);
 } else addLaunch();
 const select=extra=>w.Function(data.controls+extra)();
 const before={open:select('return !!openList;'),launch:select('return !!newShell;')};
 const opened=select('if(openList){openList.click();return true;}return false;');
 if(!select('return !!newShell;')) throw Error('Responsive launch unavailable');
 select('newShell.click();return true;');
 rows.push({narrow,before,opened,opens,launches,decoys});
 dom.window.close();
}
const negative=new JSDOM('<button>New shell</button><section aria-label="Session terminal"><button title="New shell"></button><button disabled>New shell</button></section>',{runScripts:'outside-only'});
negative.window.HTMLElement.prototype.getClientRects=()=>[{}];
const unavailable=negative.window.Function(data.controls+'return !openList && !newShell;')();
negative.window.close();
console.log(JSON.stringify({rows,unavailable}));
"""
        result = subprocess.run(['node', '-e', script],
            input=json.dumps({'controls': controls, 'module': str(module)}),
            capture_output=True, text=True, check=True, timeout=15)
        evidence = json.loads(result.stdout)
        self.assertTrue(evidence['unavailable'])
        for row in evidence['rows']:
            self.assertEqual(row['launches'], 1)
            self.assertEqual(row['opens'], int(row['narrow']))
            self.assertEqual(row['opened'], row['narrow'])
            self.assertEqual(row['before']['launch'], not row['narrow'])
            self.assertEqual(row['before']['open'], row['narrow'])
            self.assertEqual(row['decoys'], 0)

    def test_split_unicode_ack_and_written_receipt_keep_original_fetch_and_bound_metadata(self):
        source = Path(__file__).with_name('TerminalFixture.swift').read_text()
        observer = source.split('static let observer = #"""', 1)[1].split('"""#', 1)[0]
        script = r"""
const vm=require('node:vm');
const observer=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
const marker='WK-XCTEST-UNICODE: Ω中🙂';
const bytes=new TextEncoder().encode(marker);
const split=bytes.indexOf(0xce)+1; // incomplete Omega crosses actual frame shapes
let promise, calls=0, body, listeners={};
const frames=[bytes.slice(0,split),bytes.slice(split),new Uint8Array()];
let offset=0;
const context={URL,TextDecoder,Uint8Array,BigInt,location:{href:'http://127.0.0.1/'},
 document:{addEventListener:(type,handler)=>{listeners[type]=handler;}},navigator:{},
 fetch:(resource,options)=>{
   calls++;body=options.body;
   let response;
   if(resource.endsWith('/input')) response={outcome:'written'};
   else {
     const chunk=frames.shift();offset+=chunk.length;
     response={observer_id:'fixture',bytes:[...chunk],next_offset:String(offset),gap:false};
   }
   promise=Promise.resolve(new Response(JSON.stringify(response)));
   return promise;
 }};
context.window=context;
vm.createContext(context);
vm.runInContext('(function(){'+observer+'})()',context);
const flush=async predicate=>{
 const end=Date.now()+1000;
 while(!predicate()) {
  if(Date.now()>=end) throw Error('Fixture observation did not settle');
  await new Promise(resolve=>setImmediate(resolve));
 }
};
(async()=>{
 let unchanged=true;
 for(const ack of [undefined,String(split),String(bytes.length)]) {
   const options={method:'POST',body:JSON.stringify({acknowledge_offset:ack})};
   const result=context.fetch('/observers/fixture/read',options);
   unchanged&&=result===promise && body===options.body;
   await result;await flush(()=>context.__terminal352.frames.length===calls);
 }
 const input={method:'POST',body:JSON.stringify({bytes:[3]})};
 const result=context.fetch('/executions/fixture/input',input);
 unchanged&&=result===promise && body===input.body;
 await result;await flush(()=>context.__terminal352.inputSettled===1);
 for(let i=0;i<200;i++) listeners.keydown({target:{classList:{contains:()=>true}},
   isTrusted:i%2===0,isComposing:false,key:'MUST_NOT_RETAIN_EVENT_DATA'});
 const evidence=context.__terminal352;
 console.log(JSON.stringify({unchanged,calls,receipt:evidence.markerReceipts[marker],
   inputPosts:evidence.inputPosts,inputBytes:evidence.inputBytes,
   inputWritten:evidence.inputWritten,inputSettled:evidence.inputSettled,
   trustedKeys:evidence.trustedKeys,syntheticKeys:evidence.syntheticKeys,
   events:evidence.events.length,retainsEventData:JSON.stringify(evidence).includes('MUST_NOT_RETAIN')}));
})().catch(error=>{console.error(error);process.exitCode=1;});
"""
        result = subprocess.run(['node', '-e', script], input=json.dumps(observer),
                                capture_output=True, text=True, check=True, timeout=15)
        evidence = json.loads(result.stdout)
        self.assertTrue(evidence['unchanged'])
        self.assertEqual(evidence['calls'], 4)
        self.assertTrue(evidence['receipt']['acknowledged'])
        self.assertEqual(evidence['receipt']['observer'], 'fixture')
        self.assertEqual(evidence['inputPosts'], 1)
        self.assertEqual(evidence['inputBytes'], 1)
        self.assertEqual(evidence['inputWritten'], 1)
        self.assertEqual(evidence['inputSettled'], 1)
        self.assertEqual(evidence['trustedKeys'], 100)
        self.assertEqual(evidence['syntheticKeys'], 100)
        self.assertEqual(evidence['events'], 128)
        self.assertFalse(evidence['retainsEventData'])


if __name__ == '__main__':
    unittest.main()
