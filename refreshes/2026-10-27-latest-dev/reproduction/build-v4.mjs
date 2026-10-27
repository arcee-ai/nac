import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
const root='/private/tmp/nac-insights-refresh', repo='/private/tmp/nac-refresh-source';
const map=JSON.parse(await fs.readFile('/private/tmp/nac-insights-final-map.json','utf8'));
await fs.writeFile(root+'/frozen-map-v4.json',JSON.stringify(map,null,2)+'\n',{flag:'wx'});
const run=(cmd,args,options={})=>new Promise((resolve,reject)=>{const p=spawn(cmd,args,{cwd:repo,stdio:'inherit',...options});p.on('exit',code=>code===0?resolve():reject(Error(`${cmd} exited ${code}`)));});
for(const [pr,port]of [[425,4861],[426,4862],[428,4863],[429,4864],[431,4860]]){
 const sha=map.prs.find(x=>x.pr===pr).head;
 await run('git',['checkout','--detach',sha]);
 const log=await fs.open(`${root}/build${pr}-v4.log`,'wx');
 await run('cargo',['build','--locked','-p','nac-server','--bin','nac-web'],{env:{...process.env,CARGO_TARGET_DIR:'/private/tmp/nac-refresh-target',CARGO_BUILD_JOBS:'2'},stdio:['ignore',log.fd,log.fd]});await log.close();
 const binary=`${root}/binaries/pr${pr}-v4`;
 await run('cp',['-c','/private/tmp/nac-refresh-target/debug/nac-web',binary]);
 const options=`${root}/options${pr}v4.json`;
 await fs.writeFile(options,JSON.stringify({repo,output:`${root}/runtime${pr}v4`,binary,port,controlPort:port+30,sha}));
 const fixtureLog=await fs.open(`${root}/runtime${pr}v4.log`,'wx');
 const fixture=spawn(process.execPath,[`${root}/start-fixture.mjs`,options],{cwd:repo,detached:true,stdio:['ignore',fixtureLog.fd,fixtureLog.fd]});fixture.unref();await fixtureLog.close();
 console.log(JSON.stringify({pr,sha,fixturePid:fixture.pid,status:'built-and-seeding'}));
}
