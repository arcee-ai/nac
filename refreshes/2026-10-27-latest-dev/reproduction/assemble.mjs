import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [mapPath, destination, ...manifests] = process.argv.slice(2);
const frozen = JSON.parse(await fs.readFile(mapPath, 'utf8'));
const primary = {421:'buttons',422:'gallery',423:'desktop',424:'insights',425:'insights',426:'native-metadata',427:'insights',428:'stream',429:'native-git-status',430:'desktop',431:'phone'};
const allowedExtras = {421:['session-row'],422:['session-card-atoms'],425:['failed-launch','expanded-completion-report'],427:['expanded-native-output'],430:['phone'],431:['phone-insights']};
const labels = {421:'Button variants and session identity',422:'New design-preview atoms',423:'Model extraction — matching visible session',424:'Files/default panel → Insights',425:'Transcript layout, failed launch and durable report',426:'Exact native tool metadata comparison',427:'Native full content, paths and edit diff',428:'Real active run waiting for response',429:'Exact native Git conflict and typechange projection',430:'Desktop and phone composer',431:'Phone session header and panel navigation'};
const pairs = [];
for (const manifestPath of manifests) {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const groups = new Map();
  for (const item of manifest.captures) {
    const key = `${item.pr}/${item.scenario}`;
    const group = groups.get(key) ?? {};
    group[item.side] = {...item, sourceFile:path.join(path.dirname(manifestPath),'captures',item.filename), sourceManifest:manifestPath};
    groups.set(key,group);
  }
  for (const [key,pair] of groups) if (pair.before && pair.after) pairs.push({key,...pair,capturedAt:manifest.capturedAt});
}
const selected=[];
const prs=[];
for (const pr of frozen.prs) {
  const matches = pairs.filter((pair)=>pair.before.pr===pr.pr && pair.before.frontendSha===pr.base && pair.after.frontendSha===pr.head);
  const pick = (scenario) => matches.filter((pair)=>pair.before.scenario===scenario).sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt))[0];
  const main=pick(primary[pr.pr]);
  if (!main) throw Error(`No complete current pair for #${pr.pr} (${pr.base} → ${pr.head}); stale images cannot be relabeled.`);
  if ([426,429].includes(pr.pr) && (main.before.backendSha!==pr.base || main.after.backendSha!==pr.head)) throw Error(`Native #${pr.pr} requires exact immediate-base/head binaries.`);
  const extras=(allowedExtras[pr.pr]??[]).map(pick).filter(Boolean);
  selected.push(main,...extras);
  prs.push({number:pr.pr,base:pr.base,head:pr.head,label:labels[pr.pr],before:main.before.filename,after:main.after.filename,backendBefore:main.before.backendSha,backendAfter:main.after.backendSha,viewport:main.before.viewport,note:main.before.note,extra:extras.map((pair)=>({label:pair.before.scenario,before:pair.before.filename,after:pair.after.filename,note:pair.before.note,frontendBefore:pair.before.frontendSha,frontendAfter:pair.after.frontendSha,backendBefore:pair.before.backendSha,backendAfter:pair.after.backendSha,viewport:pair.before.viewport}))});
}
await fs.mkdir(destination,{recursive:false});
await fs.mkdir(path.join(destination,'screenshots'));
await fs.mkdir(path.join(destination,'accessibility'));
const captures=[];
for (const pair of selected) for (const side of ['before','after']) {
  const item=pair[side];
  if (item.errors.length) throw Error(`Page errors in ${item.filename}: ${item.errors.join('; ')}`);
  const pixels=await fs.readFile(item.sourceFile);
  if (createHash('sha256').update(pixels).digest('hex')!==item.sha256) throw Error(`Image hash mismatch: ${item.filename}`);
  await fs.writeFile(path.join(destination,'screenshots',item.filename),pixels,{flag:'wx'});
  await fs.copyFile(item.sourceFile.replace(/\.jpg$/,'.aria.txt'),path.join(destination,'accessibility',item.filename.replace(/\.jpg$/,'.aria.txt')));
  captures.push({...item,capturedAt:pair.capturedAt});
}
const manifest={captured:new Date().toISOString(),method:'Unmodified exact committed frontend bundles; deterministic local provider drives real NAC native tools in disposable stores/workspaces. No live model requests, production data, HTTP API interception, or DOM replacement.',desktopCSS:{width:1440,height:960},phoneCSS:{width:390,height:844},deviceScaleFactor:1,prs,captures,review:{status:'visually inspected',notes:'Worker inspected gallery, session, failed-launch, expanded durable report/full output, native Git status and phone navigation images. Still images do not prove animation/scrolling stability or rejected-submit attribution; focused tests cover those behaviors.'}};
await fs.writeFile(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await fs.writeFile(path.join(destination,'frozen-map.json'),JSON.stringify(frozen,null,2)+'\n');
let readme='# NAC Insights stack: current screenshot comparisons\n\nEach pair uses the exact current PR frontend head and its immediate base. Desktop1440×960; phone390×844; scale1. Native #426 and #429 use exact immediate-base/head backend binaries with identical fixture inputs replayed independently. Other pairs hold their recorded native backend/session constant. Backend SHAs, session IDs, URLs, asset-tree IDs and image hashes are retained in manifest.json.\n\nThe captured data is deterministic fixture content executed through real native tools; there are no live model requests or production data. Still images do not establish smooth streaming or scrolling.\n\n';
for (const pr of prs) {
 readme+=`## PR #${pr.number}: ${pr.label}\n\nFrontend ${pr.base.slice(0,8)} → ${pr.head.slice(0,8)}. Backend ${pr.backendBefore.slice(0,8)} → ${pr.backendAfter.slice(0,8)}.\n\n${pr.note||'Same real fixture state; no intended visual change is implied for model-only layers.'}\n\n| Before | After |\n| --- | --- |\n| ![Before #${pr.number}](screenshots/${pr.before}) | ![After #${pr.number}](screenshots/${pr.after}) |\n\n`;
 for (const extra of pr.extra) readme+=`### ${extra.label}\n\nFrontend ${extra.frontendBefore.slice(0,8)} → ${extra.frontendAfter.slice(0,8)}; backend ${extra.backendBefore.slice(0,8)} → ${extra.backendAfter.slice(0,8)}; viewport ${extra.viewport.width}×${extra.viewport.height}.\n\n${extra.note||''}\n\n| Before | After |\n| --- | --- |\n| ![Before](screenshots/${extra.before}) | ![After](screenshots/${extra.after}) |\n\n`;
}
await fs.writeFile(path.join(destination,'README.md'),readme);
console.log(JSON.stringify({destination,prs:prs.length,images:captures.length,pageErrors:captures.reduce((sum,c)=>sum+c.errors.length,0)}));
