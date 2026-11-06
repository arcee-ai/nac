// In-process React/DOM source characterization; geometry is explicitly symbolic.
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const ROOT = path.resolve(__dirname, "../..");
const web = path.join(ROOT, "crates/nac-server/web");
const nodeTest = require("node:test");
const { spawnSync } = require("node:child_process");
const { productMarkup } = require("./test_support/attention_chat_component_dom.cjs");
const req = require("node:module").createRequire(path.join(web, "package.json"));
const ts = req("typescript"),
  { JSDOM } = req("jsdom");
const swift = fs.readFileSync(path.join(__dirname, "AttentionSmoke.swift"), "utf8");
const scripts = [...swift.matchAll(/static let chatSource = #"""\n([\s\S]*?)\n    """#/g)];
assert.equal(scripts.length, 1);
const source = scripts[0][1],
  M = "NAC_QUIT_RETAINED_TRANSCRIPT";
const expected = { session: "plain", route: "/session/plain/insights", user: M, assistant: M };
function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}
const routeModule = { exports: {} };
vm.runInNewContext(transpile(path.join(web, "src/app/lib/routes.ts")), {
  exports: routeModule.exports,
  module: routeModule,
});
const routes = routeModule.exports.routes;
const vectors = ["plain", "slash/id", "space &%", "雪🙂", "!~*'()", "%2F"];
const routeValues = vectors.map((session) => ({ session, route: routes.session(session) }));
const baseline = `<div id="column"><div id="header"><p>${M}</p></div><div id="transcript"><div role="status"></div><div id="scroll"><div id="user">${M}</div><p id="assistant">${M}</p></div></div><div><textarea role="combobox" aria-label="Message" data-nac-retained-draft></textarea></div></div>`;
function inspect(html, change = () => {}, exp = expected) {
  const dom = new JSDOM(html, {
      url: "http://fixture.invalid/#" + exp.route,
      runScripts: "outside-only",
    }),
    w = dom.window,
    d = w.document;
  Object.defineProperty(w, "innerWidth", { value: 1200 });
  Object.defineProperty(w, "innerHeight", { value: 900 });
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    return this._rect || { left: 1, top: 1, right: 1100, bottom: 800, width: 1099, height: 799 };
  };
  const computed = w.getComputedStyle.bind(w);
  w.getComputedStyle = (e) => {
    const s = computed(e);
    return {
      display: s.display || "block",
      visibility: s.visibility || "visible",
      opacity: s.opacity || "1",
      overflow: s.overflow || "visible",
      overflowX: s.overflowX || "visible",
      overflowY: s.overflowY || "visible",
      pointerEvents: s.pointerEvents || "auto",
    };
  };
  let query;
  d.elementFromPoint = () => query;
  const raw = w.HTMLElement.prototype.getBoundingClientRect;
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    query = this;
    return raw.call(this);
  };
  change(w, d);
  const facts = w.Function("expected", source)(exp);
  dom.window.close();
  return JSON.parse(JSON.stringify(facts));
}
function test(name, html, change, ready) {
  nodeTest(name, () => {
    const facts = inspect(html, change);
    assert.equal(facts.ready, ready, name + ": " + JSON.stringify(facts));
  });
}
test("symbolic positive", baseline, () => {}, true);
for (const row of routeValues)
  nodeTest("encoded canonical route " + row.session, () => {
    const facts = inspect(baseline, () => {}, {
      ...expected,
      session: row.session,
      route: row.route,
    });
    assert.equal(facts.ready, true);
  });
for (const [name, change] of [
  ["bare route", (w) => (w.location.hash = "/session/plain")],
  ["wrong id", (w) => (w.location.hash = "/session/other/insights")],
  ["wrong panel", (w) => (w.location.hash = "/session/plain/files")],
  [
    "header only",
    (w, d) => {
      d.querySelector("#user").remove();
      d.querySelector("#assistant").remove();
    },
  ],
  [
    "sidebar decoy",
    (w, d) => {
      const side = d.createElement("aside");
      side.append(d.querySelector("#user"), d.querySelector("#assistant"));
      d.body.append(side);
    },
  ],
  [
    "loader",
    (w, d) => d.querySelector("[role=status]").setAttribute("aria-label", "Loading conversation"),
  ],
  ["alert", (w, d) => d.body.insertAdjacentHTML("beforeend", '<div role="alert">failed</div>')],
  ["hidden", (w, d) => (d.querySelector("#transcript").hidden = true)],
  ["inert", (w, d) => (d.querySelector("#transcript").inert = true)],
  ["aria hidden", (w, d) => d.querySelector("#user").setAttribute("aria-hidden", "true")],
  ["display none", (w, d) => (d.querySelector("#user").style.display = "none")],
  ["visibility hidden", (w, d) => (d.querySelector("#assistant").style.visibility = "hidden")],
  ["opacity", (w, d) => (d.querySelector("#scroll").style.opacity = ".5")],
  [
    "clipped",
    (w, d) => {
      const n = d.querySelector("#scroll");
      n.style.overflow = "hidden";
      n._rect = { left: 1300, top: 1, right: 1400, bottom: 4 };
    },
  ],
  [
    "off viewport",
    (w, d) => (d.querySelector("#user")._rect = { left: 1300, top: 1, right: 1400, bottom: 4 }),
  ],
  [
    "occluded",
    (w, d) => {
      const foreign = d.createElement("aside");
      d.body.append(foreign);
      d.elementFromPoint = () => foreign;
    },
  ],
  ["readonly", (w, d) => (d.querySelector("textarea").readOnly = true)],
  ["disabled", (w, d) => (d.querySelector("textarea").disabled = true)],
  ["unretained", (w, d) => d.querySelector("textarea").removeAttribute("data-nac-retained-draft")],
  ["composer hidden", (w, d) => (d.querySelector("textarea").hidden = true)],
  ["pointer none", (w, d) => (d.querySelector("textarea").style.pointerEvents = "none")],
  ["duplicate composer", (w, d) => d.body.append(d.querySelector("textarea").cloneNode(true))],
  [
    "duplicate user",
    (w, d) => d.querySelector("#scroll").append(d.querySelector("#user").cloneNode(true)),
  ],
  [
    "duplicate assistant",
    (w, d) => d.querySelector("#scroll").append(d.querySelector("#assistant").cloneNode(true)),
  ],
  ["missing assistant", (w, d) => d.querySelector("#assistant").remove()],
  [
    "ambiguous scope",
    (w, d) => {
      const column = d.querySelector("#column"),
        wrap = d.createElement("div");
      column.replaceWith(wrap);
      wrap.innerHTML = '<div></div><div role="status"></div><div></div>';
      wrap.lastChild.append(column);
      wrap.children[1].append(d.createElement("i"));
      wrap.children[1].firstChild.setAttribute("role", "status");
    },
  ],
])
  test(name, baseline, change, false);

nodeTest("Python route helper matches the actual TypeScript builder", () => {
  const code =
    "import json,sys; from attention_app_smoke import canonical_chat_route; print(json.dumps([canonical_chat_route(v) for v in json.load(sys.stdin)]))";
  const result = spawnSync("python3", ["-B", "-c", code], {
    cwd: ROOT,
    env: { ...process.env, PYTHONPATH: path.join(ROOT, "desktop/macos") },
    input: JSON.stringify(vectors),
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout),
    routeValues.map((row) => row.route),
  );
});
nodeTest("actual SessionPage/transcript/messages/composer structural alignment", async () => {
  const markup = await productMarkup(expected);
  assert.equal(inspect(markup).ready, true);
  assert.equal(
    inspect(markup, (w, d) =>
      d.querySelector("[role=status]").setAttribute("aria-label", "Loading conversation"),
    ).ready,
    false,
  );
  assert.equal(
    inspect(markup, (w, d) => {
      const body = d.querySelector("[role=status]").parentElement;
      body.querySelectorAll("p,div").forEach((n) => {
        if (n.textContent === M) n.textContent = "";
      });
    }).ready,
    false,
  );
  assert.equal(inspect(await productMarkup(expected, { readOnly: true })).ready, false);
});
