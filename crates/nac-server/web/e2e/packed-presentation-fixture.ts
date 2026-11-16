import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { EmbeddedHarness } from "./harness";
import { startHostedFixture } from "./hosted-fixture";

const execute = promisify(execFile);
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repository = path.resolve(web, "../../..");
const packageName = "@arcee-ai/nac-client-all-121";

/** No source alias, repository UI import or second presentation implementation. */
export async function startPackedPresentation(
  harness: EmbeddedHarness,
  id: string,
  options: {
    twoInstances?: boolean;
    tarball?: string;
    stylesheet?: boolean;
    initialPaths?: Partial<Record<"Left" | "Right" | "Single", string>>;
  } = {},
) {
  const consumer = path.join(harness.runRoot, "packed-consumer");
  await fs.mkdir(consumer);
  const preservedTarball = options.tarball ?? process.env.NAC_PRESENTATION_TARBALL;
  const { stdout } = preservedTarball
    ? { stdout: "null" }
    : await execute(
        "npm",
        [
          "pack",
          "--ignore-scripts",
          "--json",
          "--cache",
          path.join(consumer, "cache"),
          "--pack-destination",
          consumer,
        ],
        { cwd: repository },
      );
  const report = JSON.parse(stdout)?.[0];
  // A receiving qualification can use the preserved handoff bytes instead of
  // silently repacking another checkout. The normal lane still tests this head.
  const tarball = preservedTarball ?? path.join(consumer, report.filename);
  const tarballBytes = await fs.readFile(tarball);
  const tarballSha256 = createHash("sha256").update(tarballBytes).digest("hex");
  const expectedSha = process.env.NAC_PRESENTATION_TARBALL_SHA256;
  if (expectedSha && tarballSha256 !== expectedSha)
    throw new Error("Packed artifact SHA256 differs from pinned handoff");
  const integrity = `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`;
  if (report && integrity !== report.integrity) throw new Error("Packed tarball integrity differs");
  await fs.writeFile(
    path.join(consumer, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { [packageName]: `file:${tarball}` },
    }),
  );
  await execute(
    "npm",
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--legacy-peer-deps",
      "--no-audit",
      "--no-fund",
      "--cache",
      path.join(consumer, "cache"),
    ],
    { cwd: consumer },
  );
  // The normal lane uses NAC's locked peers. A separately authorized consumer
  // compatibility run can supply its installed locked peer directory read-only.
  const peers = process.env.NAC_PRESENTATION_PEER_ROOT ?? path.join(web, "node_modules");
  const peerVersions: Record<string, string> = {};
  const toolVersions: Record<string, string> = {};
  for (const name of ["vite", "typescript"]) {
    toolVersions[name] = JSON.parse(
      await fs.readFile(path.join(peers, name, "package.json"), "utf8"),
    ).version;
  }
  for (const name of [
    "react",
    "react-dom",
    "react-router",
    "react-router-dom",
    "scheduler",
    "@tanstack/react-query",
    "@tanstack/query-core",
    "@types/react",
    "@types/react-dom",
    "csstype",
  ]) {
    const source = path.join(peers, name);
    const destination = path.join(consumer, "node_modules", name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.symlink(source, destination, "dir");
    peerVersions[name] = JSON.parse(
      await fs.readFile(path.join(source, "package.json"), "utf8"),
    ).version;
  }
  const packed = path.join(
    consumer,
    "node_modules",
    packageName,
    "crates/nac-server/web/packages/nac-presentation/dist",
  );
  const assets = JSON.parse(await fs.readFile(path.join(packed, "assets.json"), "utf8")) as {
    assets: string[];
    mathjaxFonts: string[];
  };
  if (!assets.mathjaxFonts.length) throw new Error("Packed font asset manifest is empty");
  if (new Set(assets.assets).size !== assets.assets.length)
    throw new Error("Duplicate packed assets");
  for (const asset of assets.assets) {
    if (
      !asset.startsWith("assets/") ||
      asset.includes("\\") ||
      asset.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error("Noncanonical packed asset path");
  }
  if (assets.mathjaxFonts.some((font) => !assets.assets.includes(font)))
    throw new Error("Font absent from packed asset inventory");
  const fontDirectory = path.dirname(assets.mathjaxFonts[0]);
  if (assets.mathjaxFonts.some((font) => path.dirname(font) !== fontDirectory))
    throw new Error("MathJax font directories differ");
  const fontSha256: Record<string, string> = {};
  for (const asset of assets.assets) {
    if (assets.mathjaxFonts.includes(asset))
      fontSha256[asset] = createHash("sha256")
        .update(await fs.readFile(path.join(packed, asset)))
        .digest("hex");
    const destination = path.join(consumer, "public/native-assets", asset);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(packed, asset), destination);
  }
  await fs.writeFile(
    path.join(consumer, "index.html"),
    `<html><head><style>
body{margin:17px;background:rgb(111,22,33);font-family:monospace;color:rgb(3,4,5)}
.btn{padding:11px;border-radius:13px;color:rgb(6,7,8)}.title{font:17px monospace}
:root{--brand-500:caller-brand;--icon-color:#fa0102}@keyframes fade{to{opacity:.2}}
#caller-math{font-family:monospace;line-height:19px}
</style></head><body><div id="caller"></div><script type="module" src="/consumer.tsx"></script></body></html>`,
  );
  await fs.writeFile(
    path.join(consumer, "consumer.tsx"),
    `import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { BrowserRouter, MemoryRouter, useLocation } from "react-router-dom";
import { createNacClient } from "${packageName}";
import { createNativeRuntime, NativePresentationRoot, type NativeRuntime } from "${packageName}/presentation";
${options.stylesheet === false ? "" : `import "${packageName}/presentation/styles.css";`}
const configuration=await(await fetch('/fixture-config')).json();
const sources=new Map<string,EventSource[]>();
const open=(release:string)=>createNativeRuntime({
 scope:{owner:'fixture-owner',profile:'fixture-profile',organization:'fixture-org',host:'fixture-host',incarnation:'fixture-incarnation',endpoint:'/fixture-runtime',release},
 client:createNacClient({endpoint:'/fixture-runtime',credentials:'omit',headers:()=>({'X-Fixture-Auth':'fixture-only','X-Fixture-Binding':release})}),
 assets:{mathjaxFontUrl:${JSON.stringify("/native-assets/" + fontDirectory)}},
 eventSource:(url,init,context)=>{if(context.headers['x-fixture-auth']!=='fixture-only')throw new Error('missing stream context');const source=new EventSource(url,init);sources.set(release,[...(sources.get(release)??[]),source]);return source;}
});
const instances=configuration.twoInstances?['Left','Right']:['Single'];
const initialPaths:Record<string,string>=${JSON.stringify(options.initialPaths ?? {})};
const retired:{id:number,release:string,closed:boolean}[]=[];
const views=new Map<string,{runtime:NativeRuntime,view:ReturnType<typeof createRoot>}>();
// Caller-owned diagnostics expose identities/counts only, never query payloads.
Object.assign(globalThis,{__packedRetired:()=>retired.map(entry=>({...entry,openStreams:(sources.get(entry.release)??[]).filter(source=>source.readyState===EventSource.OPEN).length})),__packedQualification:()=>Object.fromEntries([...views].map(([name,{runtime}])=>[name,{id:runtime.id,closed:runtime.isClosed(),queryCount:runtime.queryClient.getQueryCache().getAll().length,fetching:runtime.queryClient.isFetching(),openStreams:(sources.get(runtime.scope.release)??[]).filter(source=>source.readyState===EventSource.OPEN).length,closedStreams:(sources.get(runtime.scope.release)??[]).filter(source=>source.readyState===EventSource.CLOSED).length}]))});
function retire(runtime:NativeRuntime){runtime.close();retired.push({id:runtime.id,release:runtime.scope.release,closed:runtime.isClosed()});}
function NativeLocation({name}:{name:string}){const location=useLocation();return <output hidden aria-label={name+' native location'}>{location.pathname}</output>;}
function mount(name:string,release:string){const current=views.get(name);if(current)retire(current.runtime);const runtime=open(release+'-'+name);const view=current?.view??createRoot(document.getElementById('native-mount-'+name)!);views.set(name,{runtime,view});view.render(<NativePresentationRoot runtime={runtime} router={children=><MemoryRouter initialEntries={[initialPaths[name]??'/session/'+configuration.sessionId+'/files']}><NativeLocation name={name}/>{children}</MemoryRouter>}/>);}
function close(name:string){const current=views.get(name);if(current&&!current.runtime.isClosed())retire(current.runtime);current?.view.render(null);}
function Caller(){const location=useLocation();return <><div id="sentinel" tabIndex={0} className="btn title">Caller sentinel</div><label>Host draft<input aria-label="Host draft" style={{maxWidth:"100%",boxSizing:"border-box"}}/></label><div id="caller-math" dangerouslySetInnerHTML={{__html:'<mjx-container jax="CHTML">Caller formula sentinel</mjx-container>'}}/><output aria-label="Product location">{location.pathname}</output><div style={{display:'grid',gridTemplateColumns:configuration.twoInstances?'repeat(auto-fit,minmax(min(100%,680px),1fr))':'1fr',gap:16}}>{instances.map((name:string)=><section key={name} aria-label={name+' presentation'} style={{minWidth:0}}><button onClick={()=>mount(name,'replacement')}>Replace packed runtime</button><button onClick={()=>close(name)}>Close packed runtime</button><div id={'native-mount-'+name} style={{height:'calc(100vh - 155px)',minHeight:500}}/></section>)}</div></>;}
// A second caller-owned React root does not inherit the product BrowserRouter.
flushSync(()=>createRoot(document.getElementById('caller')!).render(<BrowserRouter><Caller/></BrowserRouter>));
for(const name of instances)mount(name,'first');
`,
  );
  await fs.writeFile(
    path.join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "react-jsx",
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        lib: ["ES2022", "DOM", "DOM.Iterable"],
      },
      include: ["consumer.tsx", "styles.d.ts"],
    }),
  );
  await fs.writeFile(path.join(consumer, "styles.d.ts"), 'declare module "*.css";\n');
  await execute(path.join(peers, ".bin/tsc"), ["-p", path.join(consumer, "tsconfig.json")], {
    cwd: consumer,
  });
  await fs.writeFile(
    path.join(consumer, "vite.config.mjs"),
    `export default {root:${JSON.stringify(consumer)},base:'/',build:{outDir:process.env.NAC_HOSTED_FIXTURE_OUTPUT,emptyOutDir:true},resolve:{dedupe:['react','react-dom','react-router','react-router-dom','@tanstack/react-query','@tanstack/query-core']}};\n`,
  );
  const fixture = await startHostedFixture(harness, id, {
    twoInstances: options.twoInstances,
    build: async (output) => {
      await execute(
        path.join(peers, ".bin/vite"),
        ["build", "--config", path.join(consumer, "vite.config.mjs")],
        {
          cwd: consumer,
          env: { ...process.env, NAC_HOSTED_FIXTURE_OUTPUT: output },
          maxBuffer: 4 * 1024 * 1024,
        },
      );
      // The existing fixture's static index contract remains the single proxy writer.
      await fs.mkdir(path.join(output, "e2e/fixtures"), { recursive: true });
      await fs.copyFile(
        path.join(output, "index.html"),
        path.join(output, "e2e/fixtures/hosted.html"),
      );
    },
  });
  return {
    ...fixture,
    peerVersions,
    toolVersions,
    integrity,
    tarballSha256,
    assetInventory: assets.assets,
    fontAssets: assets.mathjaxFonts,
    fontSha256,
  };
}
