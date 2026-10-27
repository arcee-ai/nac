import fs from 'node:fs/promises';
const root='/private/tmp/nac-insights-refresh',map=JSON.parse(await fs.readFile(`${root}/frozen-map-v4.json`,'utf8'));
const runtime=JSON.parse(await fs.readFile(`${root}/runtime431v4/metadata.json`,'utf8'));
const lower=JSON.parse(await fs.readFile(`${root}/lower-config.json`,'utf8'));
const upper=JSON.parse(await fs.readFile(`${root}/upper-refreshed-config.json`,'utf8'));
const report={pr:425,key:'expanded-completion-report',before:'424',after:'425',session:'delegated',steps:[{text:'Generation 1 result',side:'after'},{text:'Generation 1 result',action:'wheel',deltaY:-180,side:'after'}],note:'Same genuine background child generation1 completion and parent acknowledgement on exact current stack-tip backend. After disclosure expanded through real summary and wheel controls. Exact frontend base/head refs, common backend held constant.'};
const frontend={repo:'/private/tmp/nac-refresh-source',output:`${root}/frontend-latest-dev-evidence`,firstPort:4900,revisions:[{key:'base',sha:map.trunk_sha},...map.prs.map(p=>({key:String(p.pr),sha:p.head}))].map(p=>({...p,backend:runtime.backend,backendSha:runtime.backendSha,sessions:runtime.sessions})),scenarios:[...lower.scenarios,report,...upper.scenarios]};
await fs.writeFile(`${root}/frontend-latest-dev-config.json`,JSON.stringify(frontend,null,2)+'\n');
const native=JSON.parse(await fs.readFile(`${root}/native-config.json`,'utf8'));native.output=`${root}/native-latest-dev-evidence`;native.firstPort=4915;
for(const rev of native.revisions){const m=JSON.parse(await fs.readFile(`${root}/runtime${rev.key}v4/metadata.json`,'utf8'));Object.assign(rev,{sha:map.prs.find(p=>p.pr===Number(rev.key)).head,backend:m.backend,backendSha:m.backendSha,sessions:m.sessions});if(rev.sha!==m.backendSha)throw Error('Native binary mismatch');}
await fs.writeFile(`${root}/native-latest-dev-config.json`,JSON.stringify(native,null,2)+'\n');
await fs.writeFile(`${root}/caption-config-v4.json`,JSON.stringify({repo:'/private/tmp/nac-refresh-source',revisions:frontend.revisions},null,2)+'\n');
console.log(JSON.stringify({frontend:frontend.output,native:native.output,sha:runtime.backendSha}));
