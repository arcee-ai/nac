"""Content-free fixture observation; these mocks never qualify WK or input."""
import json
from pathlib import Path
import subprocess
import unittest


class TerminalObserverTests(unittest.TestCase):
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
