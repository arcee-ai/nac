import { execFile } from "node:child_process";
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
export async function startPackedPresentation(harness: EmbeddedHarness, id: string) {
  const consumer = path.join(harness.runRoot, "packed-consumer");
  await fs.mkdir(consumer);
  const { stdout } = await execute(
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
  const report = JSON.parse(stdout)[0];
  await fs.writeFile(
    path.join(consumer, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { [packageName]: `file:./${report.filename}` },
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
  const fontDirectory = path.dirname(assets.mathjaxFonts[0]);
  for (const asset of assets.assets) {
    const destination = path.join(consumer, "public/native-assets", asset);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(packed, asset), destination);
  }
  await fs.writeFile(
    path.join(consumer, "index.html"),
    `<html><head><style>
body{margin:17px;background:rgb(111,22,33);font-family:monospace;color:rgb(3,4,5)}
.btn{padding:11px;border-radius:13px;color:rgb(6,7,8)}.title{font:17px monospace}
:root{--brand-500:caller-brand}@keyframes fade{to{opacity:.2}}
</style></head><body><div id="caller"></div><script type="module" src="/consumer.tsx"></script></body></html>`,
  );
  await fs.writeFile(
    path.join(consumer, "consumer.tsx"),
    `import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { BrowserRouter, MemoryRouter, useLocation } from "react-router-dom";
import { createNacClient } from "${packageName}";
import { createNativeRuntime, NativePresentationRoot, type NativeRuntime } from "${packageName}/presentation";
import "${packageName}/presentation/styles.css";
const configuration=await(await fetch('/fixture-config')).json();
const open=(release:string)=>createNativeRuntime({
 scope:{owner:'fixture-owner',profile:'fixture-profile',organization:'fixture-org',host:'fixture-host',incarnation:'fixture-incarnation',endpoint:'/fixture-runtime',release},
 client:createNacClient({endpoint:'/fixture-runtime',credentials:'omit',headers:()=>({'X-Fixture-Auth':'fixture-only'})}),
 assets:{mathjaxFontUrl:${JSON.stringify("/native-assets/" + fontDirectory)}},
 eventSource:(url,init,context)=>{if(context.headers['x-fixture-auth']!=='fixture-only')throw new Error('missing stream context');return new EventSource(url,init);}
});
let runtime:NativeRuntime;let view:ReturnType<typeof createRoot>;
function mount(release:string){runtime=open(release);view.render(<NativePresentationRoot runtime={runtime} router={children=><MemoryRouter initialEntries={['/session/'+configuration.sessionId+'/files']}>{children}</MemoryRouter>}/>);}
function Caller(){const location=useLocation();return <><div id="sentinel" tabIndex={0} className="btn title">Caller sentinel</div><output aria-label="Product location">{location.pathname}</output><button onClick={()=>{runtime.close();mount('replacement');}}>Replace packed runtime</button><button onClick={()=>{runtime.close();view.render(null);}}>Close packed runtime</button><div id="native-mount" style={{height:'calc(100vh - 95px)'}}/></>;}
// A second caller-owned React root does not inherit the product BrowserRouter.
flushSync(()=>createRoot(document.getElementById('caller')!).render(<BrowserRouter><Caller/></BrowserRouter>));
view=createRoot(document.getElementById('native-mount')!);mount('first');
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
  await execute(
    path.join(web, "node_modules/.bin/tsc"),
    ["-p", path.join(consumer, "tsconfig.json")],
    { cwd: consumer },
  );
  await fs.writeFile(
    path.join(consumer, "vite.config.mjs"),
    `export default {root:${JSON.stringify(consumer)},base:'/',build:{outDir:process.env.NAC_HOSTED_FIXTURE_OUTPUT,emptyOutDir:true},resolve:{dedupe:['react','react-dom','react-router','react-router-dom','@tanstack/react-query','@tanstack/query-core']}};\n`,
  );
  const fixture = await startHostedFixture(harness, id, {
    build: async (output) => {
      await execute(
        path.join(web, "node_modules/.bin/vite"),
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
  return { ...fixture, peerVersions, integrity: report.integrity };
}
