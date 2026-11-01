// Matched settled inspection-state capture; launched only by the finite Linux evidence owner.
// Fresh empty human chat; both frontends use one backend/store; no model requests.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawn, execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {Readable} from 'node:stream';
import {createHash, randomUUID} from 'node:crypto';

const worktree=process.env.NAC_CAPTURE_WORKTREE;
const root=process.env.NAC_CAPTURE_OUTPUT;
const binary=process.env.NAC_CAPTURE_BINARY;
const head=process.env.NAC_CAPTURE_HEAD;
if(!worktree||!root||!binary||head!=='48b9769453c7cb0b245d9f9b1f955ef4a880a431')throw Error('exact frozen capture inputs required');
const git=(...args)=>execFileSync('git',args,{cwd:worktree,encoding:'utf8'}).trim();
if(git('rev-parse','HEAD')!==head)throw Error('source head changed');
const {chromium}=createRequire(path.join(worktree,'crates/nac-server/web/package.json'))('@playwright/test');
const baseline='adefd79e7b43c35f98d760ffa5ff846dc8c13e32';
await fs.mkdir(root,{recursive:false});
const fixture=path.join(root,'fixture');
for(const name of ['home','xdg','nac-home','tmp','workspace'])await fs.mkdir(path.join(fixture,name),{recursive:true});
const baselineRoot=path.join(root,'baseline-tree');await fs.mkdir(baselineRoot);
const archive=await fs.open(path.join(root,'baseline-assets.tar'),'w');
try{execFileSync('git',['archive','--format=tar',baseline,'crates/nac-server/assets/dist'],{cwd:worktree,stdio:['ignore',archive.fd,'pipe']});}finally{await archive.close();}
execFileSync('tar',['-xf',path.join(root,'baseline-assets.tar'),'-C',baselineRoot]);
const providerRequests=[];
const stub=http.createServer((req,res)=>{
  if(req.url==='/models-dev'){res.writeHead(200,{'content-type':'application/json'});res.end('{}');return;}
  providerRequests.push({method:req.method,url:req.url});res.writeHead(503);res.end('No model traffic is authorized in this capture.');
});
await new Promise(resolve=>stub.listen(0,'127.0.0.1',resolve));
const stubUrl=`http://127.0.0.1:${stub.address().port}`;
const env={PATH:process.env.PATH,HOME:path.join(fixture,'home'),XDG_CONFIG_HOME:path.join(fixture,'xdg'),NAC_HOME:path.join(fixture,'nac-home'),TMPDIR:path.join(fixture,'tmp'),LANG:'C.UTF-8',BROWSER:'none',NAC_ORCHESTRATION:'1',NAC_E2E_API_KEY:'nac-e2e-dummy-only',MODELS_DEV_URL:`${stubUrl}/models-dev`,HTTP_PROXY:process.env.NAC_FIXTURE_DENY_PROXY,HTTPS_PROXY:process.env.NAC_FIXTURE_DENY_PROXY,ALL_PROXY:process.env.NAC_FIXTURE_DENY_PROXY,http_proxy:process.env.NAC_FIXTURE_DENY_PROXY,https_proxy:process.env.NAC_FIXTURE_DENY_PROXY,all_proxy:process.env.NAC_FIXTURE_DENY_PROXY,NO_PROXY:"127.0.0.1,localhost,::1",no_proxy:"127.0.0.1,localhost,::1"};
const child=spawn(binary,['--bind','127.0.0.1:0','--directory',path.join(fixture,'workspace'),'--store-path',path.join(fixture,'store.db'),'--worker-executable',binary,'--no-open'],{cwd:worktree,env,detached:true,stdio:['ignore','pipe','pipe']});
const logs=[];const servers=[];const network=[];let browser;let debugPage;
let spawnError=null;let rootExitObserved=false;
const closed=new Promise(resolve=>{
  child.once('exit',(code,signal)=>{rootExitObserved=true;resolve({event:'exit',code,signal});});
  child.once('error',error=>{spawnError=String(error);resolve({event:'spawn-error',error:spawnError});});
});
const meta={status:'in progress',head,baseline:{revision:baseline,assets:path.join(baselineRoot,'crates/nac-server/assets/dist'),assets_tree:git('rev-parse',`${baseline}:crates/nac-server/assets/dist`)},current:{revision:head,assets:path.join(worktree,'crates/nac-server/assets/dist'),assets_tree:git('rev-parse',`${head}:crates/nac-server/assets/dist`)},binary_path:binary,binary_sha256:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),viewport:{width:1920,height:1200},fixture:'Fresh empty human-created direct chat; no model requests or completed-work claim.',comparison:'Exact adef and 48b frontend assets over the SAME current backend/store. Browser proxy permits GET/HEAD only. Same viewport/dark context; UI-only comparison, no baseline backend qualification.',original_tmp_fixture:'Lost during host panic; not reconstructed or claimed reused.',started_at:new Date().toISOString()};
try{
  const endpoint=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('server readiness timeout')),30000);let buffered='';
    const read=chunk=>{const text=chunk.toString();logs.push(text);buffered+=text;const match=buffered.match(/nac-web listening on (http:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}};
    child.stdout.on('data',read);child.stderr.on('data',read);child.once('error',reject);child.once('exit',code=>reject(Error(`server exited ${code}`)));
  });
  meta.backend_endpoint=endpoint;
  const response=await fetch(`${endpoint}/sessions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({behavior:'direct',cwd:path.join(fixture,'workspace'),backend:'openai-responses',model:'gpt-5.6-sol',base_url:stubUrl,reasoning_effort:'high',api_key_env:'NAC_E2E_API_KEY',extra_headers:{},orchestrator_compaction_threshold:0})});
  if(!response.ok)throw Error(`fixture creation ${response.status}: ${await response.text()}`);
  const session=(await response.json()).metadata?.session_id;
  if(!session)throw Error('fixture session identity missing');
  meta.session_id=session;meta.failed_inspection_id=randomUUID();
  const detail=async()=>{const r=await fetch(`${endpoint}/sessions/${session}`);if(!r.ok)throw Error(`detail ${r.status}`);return r.json();};
  meta.before=await detail();
  if(meta.before.active_run!=null)throw Error('fixture must stay idle');
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.json':'application/json'};
  const proxy=async assetRoot=>{
    const server=http.createServer(async(req,res)=>{
      try{
        network.push({method:req.method,url:req.url});
        if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('Read-only capture');return;}
        const url=new URL(req.url,'http://fixture');const assetPath=url.pathname.startsWith('/assets/dist/')?url.pathname.slice('/assets/dist'.length):url.pathname;
        const filename=path.resolve(assetRoot,'.'+(assetPath==='/'||assetPath==='/app'?'/index.html':assetPath));
        if(filename.startsWith(assetRoot+path.sep)){
          const stat=await fs.stat(filename).catch(()=>null);
          if(stat?.isFile()){res.writeHead(200,{'content-type':types[path.extname(filename)]??'application/octet-stream','cache-control':'no-store'});res.end(req.method==='HEAD'?undefined:await fs.readFile(filename));return;}
        }
        const abort=new AbortController();res.on('close',()=>abort.abort());
        const headers={...req.headers,host:new URL(endpoint).host};delete headers.connection;
        const upstream=await fetch(endpoint+req.url,{method:req.method,headers,signal:abort.signal});network.push({url:req.url,status:upstream.status});
        res.writeHead(upstream.status,Object.fromEntries([...upstream.headers].filter(([name])=>!['transfer-encoding','content-length','content-encoding','connection'].includes(name))));
        if(upstream.body)Readable.fromWeb(upstream.body).on('error',()=>res.end()).pipe(res);else res.end();
      }catch(error){if(!res.headersSent)res.writeHead(502);res.end(String(error));}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);return `http://127.0.0.1:${server.address().port}`;
  };
  browser=await chromium.launch({headless:true});meta.captures=[];
  for(const label of ['baseline','current']){
    const origin=await proxy(meta[label].assets);const context=await browser.newContext({viewport:meta.viewport,colorScheme:'dark',serviceWorkers:'block'});
    await context.tracing.start({screenshots:true,snapshots:true,sources:false});const page=await context.newPage();debugPage=page;page.setDefaultTimeout(20000);page.on('pageerror',e=>network.push({label,pageerror:String(e)}));
    const snapshotLoaded=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname===`/sessions/${session}`);
    const failed=page.waitForResponse(r=>r.request().method()==='GET'&&r.url().includes(`/sessions/${session}/heartbeats/${meta.failed_inspection_id}`));
    await page.goto(`${origin}/#/session/${session}/heartbeats?heartbeat=${meta.failed_inspection_id}`);
    const snapshotResponse=await snapshotLoaded;await snapshotResponse.finished();
    if(!snapshotResponse.ok())throw Error(`snapshot ${snapshotResponse.status()}`);
    const snapshot=await snapshotResponse.json();
    if(snapshot.metadata?.session_id!==session||!Array.isArray(snapshot.messages)||snapshot.messages.some(m=>m.role!=='system'))throw Error('expected actual metadata/message fetch for empty fixture');
    const starter=page.getByText('Explore this repository',{exact:true});
    await starter.waitFor({state:'visible'}); // InitialPrompts requires the loaded empty snapshot; never click it.
    await page.getByRole('status',{name:'Loading conversation',exact:true}).waitFor({state:'hidden'});
    const show=page.getByRole('button',{name:'Show panel',exact:true});await show.or(page.getByRole('tab',{name:'Files',exact:true})).first().waitFor();if(await show.isVisible())await show.click();
    const inspection=await failed;await inspection.finished();if(inspection.status()!==404)throw Error(`inspection status ${inspection.status()}`);
    const error=page.getByRole('alert').filter({hasText:/heartbeat|not found/i});
    if(label==='baseline'){await page.getByText(/Choose a heartbeat/).waitFor();if(await error.count())throw Error('baseline unexpectedly shows inspection error');}
    else{await error.waitFor();if(await page.getByText(/Choose a heartbeat/).count())throw Error('current generic empty state hides error');}
    const panel=page.locator('div[aria-hidden="false"]').filter({has:page.getByRole('button',{name:'Hide panel',exact:true})});
    await panel.waitFor({state:'visible'}); // Strict locator: ambiguity is a capture failure.
    const detail=label==='baseline'?page.getByText(/Choose a heartbeat/):error;
    await page.mouse.move(1,1); // Let product tooltip close normally; do not hide or alter it.
    await page.evaluate(()=>document.fonts.ready);
    const stable=await page.waitForFunction(({panel,prompt,detail,label})=>{
      const opacity=node=>{let value=1;for(let p=node;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden')return 0;value*=Number(s.opacity);}return value;};
      if(!panel?.isConnected||!prompt?.isConnected||!detail?.isConnected||document.fonts.status!=='loaded')return false;
      if(document.querySelector('[role="status"][aria-label="Loading conversation"]'))return false;
      if(opacity(prompt)<0.999||opacity(detail)<0.999)return false;
      if([...document.querySelectorAll('.animate-shimmer,[role="tooltip"]')].some(el=>el.getBoundingClientRect().width>0&&opacity(el)>0.001))return false;
      const rect=panel.getBoundingClientRect();
      if(rect.width<480||rect.width>801||rect.left<0||rect.right>innerWidth+1||rect.top<0||rect.bottom>innerHeight+1)return false;
      // SessionPage animates the panel's width/transform; Transcript crossfades.
      // Observe their actual finite animations instead of waiting a guessed duration.
      if(document.getAnimations().some(a=>{
        const target=a.effect?.target;const relevant=target instanceof Element&&(panel.contains(target)||target.contains(panel)||target.contains(prompt));
        return relevant&&a.effect.getTiming().iterations!==Infinity&&(a.playState==='running'||a.pending);
      }))return false;
      const range=document.createRange();range.selectNodeContents(detail);const lines=[...range.getClientRects()];
      if(!lines.length)return false;
      let clip={left:0,top:0,right:innerWidth,bottom:innerHeight};
      for(let el=detail;el;el=el.parentElement){
        const style=getComputedStyle(el);const box=el.getBoundingClientRect();
        if(/hidden|clip|auto|scroll/.test(style.overflowX)){clip.left=Math.max(clip.left,box.left);clip.right=Math.min(clip.right,box.right);}
        if(/hidden|clip|auto|scroll/.test(style.overflowY)){clip.top=Math.max(clip.top,box.top);clip.bottom=Math.min(clip.bottom,box.bottom);}
      }
      if(lines.some(line=>line.left<clip.left-1||line.right>clip.right+1||line.top<clip.top-1||line.bottom>clip.bottom+1))return false;
      const geometry=JSON.stringify([rect.x,rect.y,rect.width,rect.height,...lines.flatMap(x=>[x.x,x.y,x.width,x.height])].map(x=>Math.round(x*100)/100));
      const prior=window.__nacCaptureSettling;
      const frames=prior?.label===label&&prior.geometry===geometry?prior.frames+1:1;
      window.__nacCaptureSettling={label,geometry,frames};
      if(frames<3)return false;
      return {label,stable_frames:frames,panel:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},text_line_count:lines.length,loading_conversation:false,visible_shimmer:false,tooltip:false,clipped_text:false,fonts:'loaded',finite_relevant_animations:'settled'};
    },{panel:await panel.elementHandle(),prompt:await starter.elementHandle(),detail:await detail.elementHandle(),label},{polling:'raf',timeout:20000});
    meta.settled_ui??=[];meta.settled_ui.push(await stable.jsonValue());await stable.dispose();
    const file=path.join(root,`${label}-missing-heartbeat-inspection.png`);await page.screenshot({path:file,fullPage:true});
    meta.captures.push({label,file,inspection_status:inspection.status(),visible_error:label==='current'});await context.tracing.stop({path:path.join(root,`${label}.trace.zip`)});await context.close();
  }
  meta.after=await detail();
  if(JSON.stringify(meta.before)!==JSON.stringify(meta.after))throw Error('empty fixture changed during matched capture');
  if(meta.after.active_run!=null||providerRequests.length)throw Error('capture must not perform model work');
  meta.status='passed';meta.finished_at=new Date().toISOString();console.log(JSON.stringify({head,captures:meta.captures,model_requests:providerRequests.length}));
}catch(error){
  meta.status='failed';meta.error=String(error);
  if(debugPage&&!debugPage.isClosed()){await fs.writeFile(path.join(root,'debug.html'),await debugPage.content());await debugPage.screenshot({path:path.join(root,'debug.png'),fullPage:true});}
  throw error;
}finally{
  if(browser)await browser.close();for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  const cleanup={root_before:{exit_code:child.exitCode,signal_code:child.signalCode},signals:[],descendant_settlement:'Not independently verified; observed root exit alone does not prove descendant cleanup.'};
  // Only the retained child handle is signaled; the enclosing private PID1
  // separately checks every remaining namespace member before measurement.
  if(spawnError===null&&Number.isInteger(child.pid)&&child.exitCode===null&&child.signalCode===null){
    try{cleanup.signals.push({signal:'SIGTERM',sent:child.kill('SIGTERM')});}
    catch(error){cleanup.signals.push({signal:'SIGTERM',sent:false,error:String(error)});}
  }else cleanup.sigterm_skipped='Owned root already exited or failed to spawn; do not signal its former process group.';
  await Promise.race([closed,new Promise(resolve=>setTimeout(resolve,4000))]);
  if(spawnError===null&&Number.isInteger(child.pid)&&child.exitCode===null&&child.signalCode===null){
    try{cleanup.signals.push({signal:'SIGKILL',sent:child.kill('SIGKILL')});}
    catch(error){cleanup.signals.push({signal:'SIGKILL',sent:false,error:String(error)});}
    await Promise.race([closed,new Promise(resolve=>setTimeout(resolve,4000))]);
  }
  cleanup.root_after={exit_code:child.exitCode,signal_code:child.signalCode};cleanup.spawn_error=spawnError;cleanup.root_exit_observed=rootExitObserved;
  cleanup.status=spawnError!==null?'spawn failed; no owned root started':rootExitObserved?'root exit observed; descendant settlement unverified':'UNRESOLVED';const groups=execFileSync('ps',['-axo','pid=,ppid=,pgid=,stat=,comm='],{encoding:'utf8'}).split('\n').filter(line=>{const fields=line.trim().split(/\s+/);return Number(fields[2])===child.pid;});cleanup.remaining_owned_group=groups;cleanup.descendant_settlement=groups.length===0?'No remaining owned process-group member observed after root exit; escaped descendants not independently certified.':'UNRESOLVED owned group members remain';if(groups.length)cleanup.status='UNRESOLVED';meta.cleanup=cleanup;
  if(cleanup.status==='UNRESOLVED'){meta.status='failed';meta.cleanup_error='Owned root termination was not observed within the bounded cleanup waits.';}
  stub.closeAllConnections();await new Promise(resolve=>stub.close(resolve));
  meta.provider_requests=providerRequests;await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify(meta,null,2));await fs.writeFile(path.join(root,'backend.log'),logs.join(''));await fs.writeFile(path.join(root,'network.json'),JSON.stringify(network,null,2));
  if(cleanup.status==='UNRESOLVED')throw Error(meta.cleanup_error);
}
