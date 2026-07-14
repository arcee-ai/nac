const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

const appSource = readFileSync(require.resolve("./app.js"), "utf8");
const indexSource = readFileSync(require.resolve("./index.html"), "utf8");
const context = {
  document: { addEventListener() {} },
  module: { exports: {} },
};
vm.runInNewContext(
  `${appSource}\nmodule.exports = { orderedThreadsByName, orderedThreadTiles, buildLaunchModelPayload, buildSettingsPatch, settingsValuesFromMetadata, settingsMetadataForSession, serializeExtraHeaders, managedLaunchBaseUrl, nextLaunchBaseUrlControl, launchLocationFromValues, fetchLaunchModelDefaultsForValues };`,
  context,
  { filename: "app.js" },
);
const {
  orderedThreadsByName,
  orderedThreadTiles,
  buildLaunchModelPayload,
  buildSettingsPatch,
  settingsValuesFromMetadata,
  settingsMetadataForSession,
  serializeExtraHeaders,
  managedLaunchBaseUrl,
  nextLaunchBaseUrlControl,
  launchLocationFromValues,
  fetchLaunchModelDefaultsForValues,
} = context.module.exports;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function launchValues(overrides = {}) {
  return {
    model: "",
    base_url: "",
    backend: "",
    reasoning_effort: "",
    credential_mode: "inherit",
    api_key_env: "",
    extra_headers: "",
    ...overrides,
  };
}

function settingsFixture(overrides = {}) {
  return {
    model: "gpt-5",
    base_url: "https://api.example.test/v1",
    backend: "openai-responses",
    reasoning_effort: "medium",
    credential_mode: "variable",
    api_key_env: "CUSTOM_API_KEY",
    extra_headers: '{"X-Trace":"yes"}',
    ...overrides,
  };
}

const initialSettings = settingsValuesFromMetadata({
  model: "gpt-5",
  base_url: "https://api.example.test/v1",
  backend: "openai-responses",
  reasoning_effort: "medium",
  api_key_env: "CUSTOM_API_KEY",
  extra_headers: { "X-Trace": "yes" },
});

test("thread tiles use raw case-sensitive name order independently without mutating inputs", () => {
  const sections = [
    ["ä", "a", "B", "A"],
    ["z", "Z", "aa"],
    ["beta", "alpha", "Alpha"],
  ].map((names) => names.map((name) => ({ name })));
  const before = sections.map((tiles) => tiles.map(({ name }) => name));
  const ordered = sections.map((tiles) => Array.from(
    orderedThreadTiles(tiles),
    ({ name }) => name,
  ));

  assert.deepEqual(Array.from(ordered[0]), ["A", "B", "a", "ä"]);
  assert.deepEqual(Array.from(ordered[1]), ["Z", "aa", "z"]);
  assert.deepEqual(Array.from(ordered[2]), ["Alpha", "alpha", "beta"]);
  assert.deepEqual(
    sections.map((tiles) => tiles.map(({ name }) => name)),
    before,
  );
});

test("Events worker groups sort each lifecycle section without reordering their entries", () => {
  const sections = [
    ["runner-z", "Runner-A", "runner-a"],
    ["queued-2", "queued-10"],
    ["finished/ä", "finished/a", "Finished"],
  ].map((names, sectionIndex) => names.map((name, groupIndex) => ({
    name,
    items: [
      `newest-${sectionIndex}-${groupIndex}`,
      `middle-${sectionIndex}-${groupIndex}`,
      `oldest-${sectionIndex}-${groupIndex}`,
    ],
  })));
  const beforeNames = sections.map((groups) => groups.map(({ name }) => name));
  const beforeItems = new Map(sections.flat().map((group) => [group, [...group.items]]));
  const ordered = sections.map((groups) => orderedThreadsByName(groups));

  assert.deepEqual(Array.from(ordered[0], ({ name }) => name), ["Runner-A", "runner-a", "runner-z"]);
  assert.deepEqual(Array.from(ordered[1], ({ name }) => name), ["queued-10", "queued-2"]);
  assert.deepEqual(Array.from(ordered[2], ({ name }) => name), ["Finished", "finished/a", "finished/ä"]);
  assert.deepEqual(
    sections.map((groups) => groups.map(({ name }) => name)),
    beforeNames,
  );
  for (const group of sections.flat()) {
    assert.deepEqual(group.items, beforeItems.get(group));
  }
});


test("launch and settings backend selectors expose explicit Arcee modes only", () => {
  for (const id of ["launchBackend", "settingsBackend"]) {
    const select = indexSource.match(new RegExp(`<select id="${id}"[\\s\\S]*?</select>`))[0];
    assert.match(select, /value="arcee-auth">arcee-auth</);
    assert.match(select, /value="arcee-api">arcee-api</);
    assert.doesNotMatch(select, /value="arcee"/);
    assert.doesNotMatch(select, /value="auto"/);
  }
  assert.match(indexSource, /arcee-auth[\s\S]*stored Arcee login/);
  assert.match(indexSource, /arcee-api[\s\S]*requires an environment variable/);
  assert.match(indexSource, /chatgpt-codex-responses[\s\S]*stored Codex OAuth/);
});

test("launch omits the backend credential guidance paragraph", () => {
  const launchForm = indexSource.match(/<form id="launchForm"[\s\S]*?<\/form>/)[0];
  assert.doesNotMatch(launchForm, /credential-help/);
  assert.doesNotMatch(launchForm, /stored Arcee login|stored Codex OAuth|Every other backend requires/);
});

test("managed launch backends lock canonical URLs and restore the non-managed draft", () => {
  let control = {
    value: "https://custom.example/v1",
    readOnly: false,
    restoreValue: "",
  };
  control = plain(nextLaunchBaseUrlControl(control, "arcee-auth", "openai-responses"));
  assert.deepEqual(control, {
    value: "https://api.arcee.ai/api/v1",
    readOnly: true,
    restoreValue: "https://custom.example/v1",
  });

  control = plain(nextLaunchBaseUrlControl(
    control,
    "chatgpt-codex-responses",
    "openai-responses",
  ));
  assert.deepEqual(control, {
    value: "https://chatgpt.com/backend-api",
    readOnly: true,
    restoreValue: "https://custom.example/v1",
  });

  control = plain(nextLaunchBaseUrlControl(control, "together-chat", "arcee-auth"));
  assert.deepEqual(control, {
    value: "https://custom.example/v1",
    readOnly: false,
    restoreValue: "https://custom.example/v1",
  });

  const inherited = plain(nextLaunchBaseUrlControl(
    { value: "", readOnly: false, restoreValue: "stale" },
    "",
    "arcee-auth",
  ));
  assert.deepEqual(inherited, {
    value: "https://api.arcee.ai/api/v1",
    readOnly: true,
    restoreValue: "",
  });
  assert.deepEqual(
    plain(nextLaunchBaseUrlControl(inherited, "", "openai-responses")),
    { value: "", readOnly: false, restoreValue: "" },
  );
  assert.equal(managedLaunchBaseUrl("arcee-api"), null);
  assert.match(appSource, /launchBackend\.addEventListener\("change", renderLaunchBaseUrlControl\)/);
  assert.match(appSource, /el\.launchBaseUrl\.readOnly = next\.readOnly/);
});

test("launch defaults requests use creation-equivalent local and SSH locations", async () => {
  const requests = [];
  const postDefaults = async (path, body) => {
    requests.push([path, body]);
    return { configured_model_backend: "arcee-auth" };
  };

  const local = await fetchLaunchModelDefaultsForValues({
    cwd: " /repo/worktree ",
    ssh_host: "",
  }, postDefaults);
  const remote = await fetchLaunchModelDefaultsForValues({
    cwd: "   ",
    ssh_host: " build-box ",
  }, postDefaults);

  assert.deepEqual(plain(local.location), { cwd: "/repo/worktree", ssh_host: null });
  assert.deepEqual(plain(remote.location), { cwd: "~", ssh_host: "build-box" });
  assert.deepEqual(plain(requests), [
    ["/sessions/launch-defaults", { cwd: "/repo/worktree", ssh_host: null }],
    ["/sessions/launch-defaults", { cwd: "~", ssh_host: "build-box" }],
  ]);
});

test("each launch refreshes changed config before payload construction and preserves the base draft", async () => {
  let configuredBackend = "openai-responses";
  const requests = [];
  const postDefaults = async (path, body) => {
    requests.push([path, body, configuredBackend]);
    return { configured_model_backend: configuredBackend };
  };
  const values = launchValues({
    cwd: "/repo",
    base_url: "https://custom.example/v1",
  });
  let control = {
    value: values.base_url,
    readOnly: false,
    restoreValue: "",
  };

  let refreshed = await fetchLaunchModelDefaultsForValues(values, postDefaults);
  let payload = buildLaunchModelPayload({
    ...values,
    configured_backend: refreshed.defaults.configured_model_backend,
  });
  assert.deepEqual(plain(payload), { base_url: "https://custom.example/v1" });

  configuredBackend = "arcee-auth";
  refreshed = await fetchLaunchModelDefaultsForValues(values, postDefaults);
  control = plain(nextLaunchBaseUrlControl(
    control,
    values.backend,
    refreshed.defaults.configured_model_backend,
  ));
  payload = buildLaunchModelPayload({
    ...values,
    base_url: control.value,
    configured_backend: refreshed.defaults.configured_model_backend,
  });
  assert.deepEqual(control, {
    value: "https://api.arcee.ai/api/v1",
    readOnly: true,
    restoreValue: "https://custom.example/v1",
  });
  assert.deepEqual(plain(payload), {});

  configuredBackend = "openai-responses";
  refreshed = await fetchLaunchModelDefaultsForValues(values, postDefaults);
  control = plain(nextLaunchBaseUrlControl(
    control,
    values.backend,
    refreshed.defaults.configured_model_backend,
  ));
  assert.deepEqual(control, {
    value: "https://custom.example/v1",
    readOnly: false,
    restoreValue: "https://custom.example/v1",
  });
  assert.equal(requests.length, 3, "defaults must be fetched for every launch attempt");

  const createSource = appSource.match(/async function createSession[\s\S]*?\n}\n\nasync function submitPrompt/)[0];
  assert.ok(
    createSource.indexOf("await refreshLaunchModelDefaults")
      < createSource.indexOf("buildLaunchModelPayload"),
    "submission must await refreshed defaults before building its payload",
  );
  assert.doesNotMatch(createSource, /state\.store.*configured_model_backend/);
  assert.match(appSource, /showLaunchOverlay[\s\S]*refreshLaunchModelDefaults/);
  assert.match(appSource, /launchCwd\.addEventListener\("change", refreshOpenLaunchModelDefaults\)/);
  assert.match(appSource, /launchSshHost\.addEventListener\("change", refreshOpenLaunchModelDefaults\)/);
});

test("managed launch payloads override explicit backends but preserve inherited config", () => {
  assert.deepEqual(plain(buildLaunchModelPayload(launchValues({
    backend: "arcee-auth",
    base_url: "https://stale.example/v1",
    credential_mode: "none",
  }))), {
    backend: "arcee-auth",
    base_url: "https://api.arcee.ai/api/v1",
    api_key_env: null,
  });
  assert.deepEqual(plain(buildLaunchModelPayload(launchValues({
    backend: "chatgpt-codex-responses",
    credential_mode: "none",
  }))), {
    backend: "chatgpt-codex-responses",
    base_url: "https://chatgpt.com/backend-api",
    api_key_env: null,
  });

  for (const configured_backend of ["arcee-auth", "chatgpt-codex-responses"]) {
    assert.deepEqual(plain(buildLaunchModelPayload(launchValues({
      base_url: managedLaunchBaseUrl(configured_backend),
      configured_backend,
    }))), {});
  }
});

test("launch omits inherited model settings and sends header JSON as objects", () => {
  assert.deepEqual(plain(buildLaunchModelPayload(launchValues())), {});
  assert.deepEqual(plain(buildLaunchModelPayload(launchValues({
    extra_headers: '{"X-Custom":"value"}',
  }))), { extra_headers: { "X-Custom": "value" } });
  assert.deepEqual(plain(buildLaunchModelPayload(launchValues({
    extra_headers: "{}",
  }))), { extra_headers: {} });
  assert.equal(serializeExtraHeaders("", undefined), undefined);
});

test("launch rejects whitespace concrete values and enforces explicit credential modes", () => {
  assert.throws(
    () => buildLaunchModelPayload(launchValues({ model: "   " })),
    /Model cannot contain only whitespace/,
  );
  assert.throws(
    () => buildLaunchModelPayload(launchValues({ backend: "arcee-auth" })),
    /explicitly select No API key environment variable/,
  );
  assert.deepEqual(plain(buildLaunchModelPayload(launchValues({
    backend: "arcee-auth",
    credential_mode: "none",
  }))), {
    backend: "arcee-auth",
    base_url: "https://api.arcee.ai/api/v1",
    api_key_env: null,
  });
  assert.throws(
    () => buildLaunchModelPayload(launchValues({
      backend: "arcee-api",
      credential_mode: "none",
    })),
    /requires an API key environment variable/,
  );
  assert.deepEqual(plain(buildLaunchModelPayload(launchValues({
    backend: "arcee-api",
    credential_mode: "variable",
    api_key_env: "ARCEE_CUSTOM_KEY",
  }))), { backend: "arcee-api", api_key_env: "ARCEE_CUSTOM_KEY" });
  for (const api_key_env of ["   ", " ARCEE_CUSTOM_KEY ", "ARCEE-CUSTOM-KEY"]) {
    assert.throws(
      () => buildLaunchModelPayload(launchValues({
        backend: "arcee-api",
        credential_mode: "variable",
        api_key_env,
      })),
      /must match \[A-Za-z_\]\[A-Za-z0-9_\]\* exactly/,
    );
  }
});

test("settings metadata and payload validation preserve selectors exactly", () => {
  for (const api_key_env of ["", " SURROUNDED_KEY "]) {
    const metadata = settingsValuesFromMetadata({
      model: "gpt-5",
      base_url: "https://api.example.test/v1",
      backend: "openai-responses",
      api_key_env,
      extra_headers: {},
    });
    assert.equal(metadata.api_key_env, api_key_env);
  }

  assert.throws(
    () => buildSettingsPatch(
      settingsFixture({ api_key_env: " CUSTOM_API_KEY " }),
      initialSettings,
    ),
    /must match \[A-Za-z_\]\[A-Za-z0-9_\]\* exactly/,
  );
  assert.deepEqual(
    plain(buildSettingsPatch(settingsFixture({ api_key_env: "EXACT_API_KEY" }), initialSettings)),
    { api_key_env: "EXACT_API_KEY" },
  );
});

test("settings PATCH contains changed fields only", () => {
  assert.deepEqual(plain(buildSettingsPatch(settingsFixture(), initialSettings)), {});
  assert.deepEqual(plain(buildSettingsPatch(settingsFixture({ model: "gpt-5.1" }), initialSettings)), {
    model: "gpt-5.1",
  });
  assert.deepEqual(plain(buildSettingsPatch(settingsFixture({
    extra_headers: '{ "X-Trace": "yes" }',
  }), initialSettings)), {});
  assert.deepEqual(plain(buildSettingsPatch(settingsFixture({
    reasoning_effort: "none",
  }), initialSettings)), { reasoning_effort: "none" });
});

test("settings explicitly clears optional fields with null and empty header object", () => {
  const patch = buildSettingsPatch(settingsFixture({
    reasoning_effort: "__clear__",
    extra_headers: "",
  }), initialSettings);
  assert.deepEqual(plain(patch), {
    reasoning_effort: null,
    extra_headers: {},
  });

  const storedInitial = settingsValuesFromMetadata({
    model: "claude",
    base_url: "https://api.anthropic.com",
    backend: "anthropic-messages",
    reasoning_effort: null,
    api_key_env: "ANTHROPIC_CUSTOM_KEY",
    extra_headers: {},
  });
  const cleared = buildSettingsPatch(settingsFixture({
    model: "claude",
    base_url: "https://api.anthropic.com",
    backend: "arcee-auth",
    reasoning_effort: "__clear__",
    credential_mode: "none",
    api_key_env: "",
    extra_headers: "",
  }), storedInitial);
  assert.deepEqual(plain(cleared), { backend: "arcee-auth", api_key_env: null });
});

test("settings rejects required clearing and stale selectors across backend transitions", () => {
  assert.throws(
    () => buildSettingsPatch(settingsFixture({ model: " " }), initialSettings),
    /Model is required and cannot be cleared/,
  );
  assert.throws(
    () => buildSettingsPatch(settingsFixture({ backend: "chatgpt-codex-responses" }), initialSettings),
    /stored Codex OAuth.*No API key environment variable/,
  );

  const authInitial = settingsValuesFromMetadata({
    model: "arcee-model",
    base_url: "https://api.arcee.ai",
    backend: "arcee-auth",
    reasoning_effort: null,
    api_key_env: null,
    extra_headers: {},
  });
  assert.throws(
    () => buildSettingsPatch(settingsFixture({
      model: "arcee-model",
      base_url: "https://api.arcee.ai",
      backend: "openai-responses",
      reasoning_effort: "__clear__",
      credential_mode: "none",
      api_key_env: "",
      extra_headers: "",
    }), authInitial),
    /requires an API key environment variable/,
  );
});

test("settings metadata falls back to persisted config when no resumed snapshot exists", async () => {
  const persisted = {
    session_id: "incomplete-session",
    model: "repair-model",
    base_url: "https://api.example.test/v1",
    backend: "openai-responses",
    reasoning_effort: null,
    api_key_env: null,
    extra_headers: {},
  };
  const requests = [];
  const metadata = await settingsMetadataForSession(
    persisted.session_id,
    undefined,
    async (path) => {
      requests.push(path);
      return persisted;
    },
  );

  assert.equal(metadata, persisted);
  assert.deepEqual(requests, ["/sessions/incomplete-session/config"]);
  assert.deepEqual(plain(settingsValuesFromMetadata(metadata)), {
    model: "repair-model",
    base_url: "https://api.example.test/v1",
    backend: "openai-responses",
    reasoning_effort: null,
    api_key_env: null,
    extra_headers: {},
  });
  assert.match(appSource, /Snapshot unavailable\. Open settings to repair/);
  assert.match(appSource, /el\.settingsBtn\.disabled = !selectedEntry/);
});

test("raw persisted settings preserve unsupported values and force explicit repair", () => {
  const invalid = settingsValuesFromMetadata({
    model: "gpt-5",
    base_url: "https://api.example.test/v1",
    backend: "auto",
    reasoning_effort: "ultra",
    api_key_env: "CUSTOM_API_KEY",
    extra_headers_json: "{broken",
    diagnostics: ["unsupported backend", "malformed headers"],
  });
  assert.equal(invalid.backend, "auto");
  assert.equal(invalid.reasoning_effort, "ultra");
  assert.equal(invalid.extra_headers_invalid, true);
  assert.deepEqual(plain(buildSettingsPatch(settingsFixture({
    backend: "openai-responses",
    reasoning_effort: "medium",
    extra_headers: "",
  }), invalid)), {
    backend: "openai-responses",
    reasoning_effort: "medium",
    extra_headers: {},
  });

  const missingBackend = settingsValuesFromMetadata({
    model: "gpt-5",
    base_url: "https://api.example.test/v1",
    backend: null,
    reasoning_effort: null,
    api_key_env: "CUSTOM_API_KEY",
    extra_headers_json: null,
  });
  assert.equal(missingBackend.backend, "");
  assert.deepEqual(plain(buildSettingsPatch(settingsFixture({
    reasoning_effort: "__clear__",
    extra_headers: "",
  }), missingBackend)), { backend: "openai-responses" });
  assert.match(appSource, /unsupported — select a replacement/);
  assert.match(appSource, /Repair required:/);
});

test("settings metadata uses an available snapshot without fetching persisted config", async () => {
  const metadata = { model: "ready-model", api_key_env: "MISSING_CURRENT_VALUE" };
  const loaded = await settingsMetadataForSession(
    "ready-session",
    { metadata },
    async () => {
      throw new Error("persisted endpoint should not be requested");
    },
  );
  assert.equal(loaded, metadata);
});
