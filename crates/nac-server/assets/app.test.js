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
  `${appSource}\nmodule.exports = { orderedThreadsByName, orderedThreadTiles, buildLaunchModelPayload, buildSettingsPatch, settingsValuesFromMetadata, settingsFormStateFromMetadata, settingsMetadataForSession, serializeExtraHeaders, managedLaunchBaseUrl, nextLaunchBaseUrlControl, nextLaunchCredentialControl, nextSettingsBaseUrlControl, nextSettingsCredentialControl, launchLocationFromValues, fetchLaunchModelDefaultsForValues };`,
  context,
  { filename: "app.js" },
);
const {
  orderedThreadsByName,
  orderedThreadTiles,
  buildLaunchModelPayload,
  buildSettingsPatch,
  settingsValuesFromMetadata,
  settingsFormStateFromMetadata,
  settingsMetadataForSession,
  serializeExtraHeaders,
  managedLaunchBaseUrl,
  nextLaunchBaseUrlControl,
  nextLaunchCredentialControl,
  nextSettingsBaseUrlControl,
  nextSettingsCredentialControl,
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

function valuesFromSettingsFormState(formState, overrides = {}) {
  return {
    model: formState.model,
    base_url: formState.baseUrlControl.value,
    backend: formState.backend,
    reasoning_effort: formState.reasoning_effort,
    credential_mode: formState.credentialControl.mode,
    api_key_env: formState.credentialControl.value,
    extra_headers: formState.extra_headers,
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
});

test("launch and settings omit long managed credential guidance", () => {
  for (const id of ["launchForm", "settingsForm"]) {
    const form = indexSource.match(new RegExp(`<form id="${id}"[\\s\\S]*?</form>`))[0];
    assert.doesNotMatch(form, /credential-help/);
    assert.doesNotMatch(form, /stored Arcee login|stored Codex OAuth|Every other backend requires/);
  }
  assert.doesNotMatch(appSource, /explicitly select No API key environment variable/i);
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
  const inheritedServerValue = plain(nextLaunchBaseUrlControl(
    { value: "", readOnly: false, restoreValue: "" },
    "",
    "chatgpt-codex-responses",
    "https://chatgpt.com/backend-api",
  ));
  assert.deepEqual(inheritedServerValue, {
    value: "https://chatgpt.com/backend-api",
    readOnly: true,
    restoreValue: "",
  });
  assert.deepEqual(
    plain(nextLaunchBaseUrlControl(inherited, "", "openai-responses")),
    { value: "", readOnly: false, restoreValue: "" },
  );
  assert.equal(managedLaunchBaseUrl("arcee-api"), null);
  assert.match(appSource, /launchBackend\.addEventListener\("change", renderLaunchModelControls\)/);
  assert.match(appSource, /el\.launchBaseUrl\.readOnly = next\.readOnly/);
});

test("managed launch backends lock no-key credentials across transitions and restore named drafts", () => {
  let control = {
    mode: "variable",
    value: "CUSTOM_API_KEY",
    locked: false,
    restoreMode: "inherit",
    restoreValue: "",
  };
  control = plain(nextLaunchCredentialControl(control, "arcee-auth", "openai-responses"));
  assert.deepEqual(control, {
    mode: "none",
    value: "",
    locked: true,
    restoreMode: "variable",
    restoreValue: "CUSTOM_API_KEY",
  });

  control = plain(nextLaunchCredentialControl(
    control,
    "chatgpt-codex-responses",
    "arcee-auth",
  ));
  assert.deepEqual(control, {
    mode: "none",
    value: "",
    locked: true,
    restoreMode: "variable",
    restoreValue: "CUSTOM_API_KEY",
  });

  control = plain(nextLaunchCredentialControl(control, "arcee-api", "arcee-auth"));
  assert.deepEqual(control, {
    mode: "variable",
    value: "CUSTOM_API_KEY",
    locked: false,
    restoreMode: "variable",
    restoreValue: "CUSTOM_API_KEY",
  });

  const inheritedDraft = plain(nextLaunchCredentialControl({
    mode: "inherit",
    value: "",
    locked: false,
    restoreMode: "variable",
    restoreValue: "OLD_KEY",
  }, "", "arcee-auth"));
  assert.deepEqual(inheritedDraft, {
    mode: "none",
    value: "",
    locked: true,
    restoreMode: "inherit",
    restoreValue: "",
  });
  assert.deepEqual(
    plain(nextLaunchCredentialControl(inheritedDraft, "", "openai-responses")),
    {
      mode: "inherit",
      value: "",
      locked: false,
      restoreMode: "inherit",
      restoreValue: "",
    },
  );

  assert.match(appSource, /el\.launchCredentialMode\.disabled = next\.locked/);
  assert.match(appSource, /Stored credentials are selected automatically/);
});

test("launch credential drafts survive modal reuse and launch-default refresh transitions", () => {
  let control = {
    mode: "variable",
    value: "REUSED_API_KEY",
    locked: false,
    restoreMode: "inherit",
    restoreValue: "",
  };

  // First open applies inherited managed defaults.
  control = plain(nextLaunchCredentialControl(control, "", "arcee-auth"));
  assert.equal(control.locked, true);

  // Reopening starts a new refresh by clearing old configured defaults.
  control = plain(nextLaunchCredentialControl(control, "", null));
  assert.deepEqual(control, {
    mode: "variable",
    value: "REUSED_API_KEY",
    locked: false,
    restoreMode: "variable",
    restoreValue: "REUSED_API_KEY",
  });

  // The winning location/config response alone reapplies managed state.
  control = plain(nextLaunchCredentialControl(control, "", "chatgpt-codex-responses"));
  assert.equal(control.mode, "none");
  assert.equal(control.locked, true);
  control = plain(nextLaunchCredentialControl(control, "", "together-chat"));
  assert.equal(control.mode, "variable");
  assert.equal(control.value, "REUSED_API_KEY");
  assert.equal(control.locked, false);

  const beginSource = appSource.match(/function beginLaunchModelDefaultsRequest[\s\S]*?\n}/)[0];
  const applySource = appSource.match(/function applyLaunchModelDefaults[\s\S]*?\n}/)[0];
  const refreshSource = appSource.match(/async function refreshLaunchModelDefaults[\s\S]*?\n}/)[0];
  assert.match(beginSource, /renderLaunchModelControls\(\)/);
  assert.match(applySource, /renderLaunchModelControls\(\)/);
  assert.match(refreshSource, /if \(applied\) \{[\s\S]*applyLaunchModelDefaults/);
  assert.match(refreshSource, /requestGeneration === state\.launchDefaultsRequestGeneration/);
  assert.match(refreshSource, /launchLocationKey\(currentLocation\) === expectedKey/);
  assert.match(refreshSource, /!el\.launchOverlay\.hidden/);
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
  assert.deepEqual(plain(payload), { api_key_env: null });

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

test("managed launch payloads send exact explicit and inherited credential clearing", () => {
  assert.deepEqual(plain(buildLaunchModelPayload(launchValues({
    backend: "arcee-auth",
    base_url: "https://stale.example/v1",
    credential_mode: "variable",
    api_key_env: "STALE_CONFIG_KEY",
  }))), {
    backend: "arcee-auth",
    base_url: "https://api.arcee.ai/api/v1",
    api_key_env: null,
  });
  assert.deepEqual(plain(buildLaunchModelPayload(launchValues({
    backend: "chatgpt-codex-responses",
    credential_mode: "inherit",
  }))), {
    backend: "chatgpt-codex-responses",
    base_url: "https://chatgpt.com/backend-api",
    api_key_env: null,
  });

  for (const configured_backend of ["arcee-auth", "chatgpt-codex-responses"]) {
    assert.deepEqual(plain(buildLaunchModelPayload(launchValues({
      base_url: managedLaunchBaseUrl(configured_backend),
      configured_backend,
      credential_mode: "variable",
      api_key_env: "STALE_CONFIG_KEY",
    }))), { api_key_env: null });
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

test("launch rejects whitespace values and enforces credentials only for API-key backends", () => {
  assert.throws(
    () => buildLaunchModelPayload(launchValues({ model: "   " })),
    /Model cannot contain only whitespace/,
  );
  assert.deepEqual(plain(buildLaunchModelPayload(launchValues({
    backend: "arcee-auth",
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
  assert.deepEqual(plain(cleared), {
    base_url: "https://api.arcee.ai/api/v1",
    backend: "arcee-auth",
    api_key_env: null,
  });
});

test("settings normalizes managed dependencies and still rejects missing API credentials", () => {
  assert.throws(
    () => buildSettingsPatch(settingsFixture({ model: " " }), initialSettings),
    /Model is required and cannot be cleared/,
  );
  assert.deepEqual(plain(buildSettingsPatch(settingsFixture({
    backend: "chatgpt-codex-responses",
  }), initialSettings)), {
    base_url: "https://chatgpt.com/backend-api",
    backend: "chatgpt-codex-responses",
    api_key_env: null,
  });

  const authInitial = settingsValuesFromMetadata({
    model: "arcee-model",
    base_url: "https://api.arcee.ai/api/v1",
    backend: "arcee-auth",
    reasoning_effort: null,
    api_key_env: null,
    extra_headers: {},
  });
  assert.throws(
    () => buildSettingsPatch(settingsFixture({
      model: "arcee-model",
      base_url: "https://api.arcee.ai/api/v1",
      backend: "openai-responses",
      reasoning_effort: "__clear__",
      credential_mode: "none",
      api_key_env: "",
      extra_headers: "",
    }), authInitial),
    /requires an API key environment variable/,
  );
});

test("settings modal hydration canonicalizes and locks managed controls", () => {
  const codex = plain(settingsFormStateFromMetadata({
    model: "gpt-5-codex",
    base_url: "https://chatgpt.com/backend-api",
    backend: "chatgpt-codex-responses",
    reasoning_effort: "high",
    api_key_env: null,
    extra_headers: { "X-Codex": "yes" },
  }));
  assert.deepEqual(codex.baseUrlControl, {
    value: "https://chatgpt.com/backend-api",
    readOnly: true,
    restoreValue: "",
  });
  assert.deepEqual(codex.credentialControl, {
    mode: "none",
    value: "",
    locked: true,
    restoreMode: "variable",
    restoreValue: "",
  });
  assert.equal(codex.extra_headers, '{\n  "X-Codex": "yes"\n}');

  const incompleteArcee = plain(settingsFormStateFromMetadata({
    model: "arcee-model",
    base_url: "",
    backend: "arcee-auth",
    reasoning_effort: null,
    api_key_env: "STALE_API_KEY",
    extra_headers_json: null,
  }));
  assert.deepEqual(incompleteArcee.baseUrlControl, {
    value: "https://api.arcee.ai/api/v1",
    readOnly: true,
    restoreValue: "",
  });
  assert.deepEqual(incompleteArcee.credentialControl, {
    mode: "none",
    value: "",
    locked: true,
    restoreMode: "variable",
    restoreValue: "STALE_API_KEY",
  });
  assert.equal(incompleteArcee.initial.base_url, "");
  assert.equal(incompleteArcee.initial.api_key_env, "STALE_API_KEY");
  assert.match(appSource, /settingsBackend\.addEventListener\("change", renderSettingsModelControls\)/);
  assert.match(appSource, /el\.settingsBaseUrl\.readOnly = formState\.baseUrlControl\.readOnly/);
  assert.match(appSource, /el\.settingsCredentialMode\.disabled = formState\.credentialControl\.locked/);
});

test("settings managed transitions preserve non-managed base and credential drafts", () => {
  let base = {
    value: "https://tenant.example.test/v1",
    readOnly: false,
    restoreValue: "",
  };
  let credential = {
    mode: "variable",
    value: "TENANT_API_KEY",
    locked: false,
    restoreMode: "none",
    restoreValue: "",
  };

  base = plain(nextSettingsBaseUrlControl(base, "arcee-auth"));
  credential = plain(nextSettingsCredentialControl(credential, "arcee-auth"));
  assert.deepEqual(base, {
    value: "https://api.arcee.ai/api/v1",
    readOnly: true,
    restoreValue: "https://tenant.example.test/v1",
  });
  assert.deepEqual(credential, {
    mode: "none",
    value: "",
    locked: true,
    restoreMode: "variable",
    restoreValue: "TENANT_API_KEY",
  });

  base = plain(nextSettingsBaseUrlControl(base, "chatgpt-codex-responses"));
  credential = plain(nextSettingsCredentialControl(credential, "chatgpt-codex-responses"));
  assert.equal(base.value, "https://chatgpt.com/backend-api");
  assert.equal(base.restoreValue, "https://tenant.example.test/v1");
  assert.equal(credential.restoreValue, "TENANT_API_KEY");

  base = plain(nextSettingsBaseUrlControl(base, "arcee-api"));
  credential = plain(nextSettingsCredentialControl(credential, "arcee-api"));
  assert.deepEqual(base, {
    value: "https://tenant.example.test/v1",
    readOnly: false,
    restoreValue: "https://tenant.example.test/v1",
  });
  assert.deepEqual(credential, {
    mode: "variable",
    value: "TENANT_API_KEY",
    locked: false,
    restoreMode: "variable",
    restoreValue: "TENANT_API_KEY",
  });
});

test("settings managed PATCHes are exact, sparse, and repair raw dependencies", () => {
  for (const [backend, base_url] of [
    ["chatgpt-codex-responses", "https://chatgpt.com/backend-api"],
    ["arcee-auth", "https://api.arcee.ai/api/v1"],
  ]) {
    const valid = settingsFormStateFromMetadata({
      model: "managed-model",
      base_url,
      backend,
      reasoning_effort: null,
      api_key_env: null,
      extra_headers: {},
    });
    assert.deepEqual(
      plain(buildSettingsPatch(valuesFromSettingsFormState(valid), valid.initial)),
      {},
    );
  }

  const incomplete = settingsFormStateFromMetadata({
    model: "managed-model",
    base_url: "",
    backend: "arcee-auth",
    reasoning_effort: null,
    api_key_env: "STALE_API_KEY",
    extra_headers: {},
  });
  assert.deepEqual(
    plain(buildSettingsPatch(valuesFromSettingsFormState(incomplete), incomplete.initial)),
    {
      base_url: "https://api.arcee.ai/api/v1",
      api_key_env: null,
    },
  );

  const whitespaceRaw = settingsFormStateFromMetadata({
    model: "managed-model",
    base_url: " https://chatgpt.com/backend-api ",
    backend: "chatgpt-codex-responses",
    reasoning_effort: null,
    api_key_env: null,
    extra_headers: {},
  });
  assert.deepEqual(
    plain(buildSettingsPatch(valuesFromSettingsFormState(whitespaceRaw), whitespaceRaw.initial)),
    { base_url: "https://chatgpt.com/backend-api" },
  );

  const managedToManaged = settingsFormStateFromMetadata({
    model: "managed-model",
    base_url: "https://api.arcee.ai/api/v1",
    backend: "arcee-auth",
    reasoning_effort: null,
    api_key_env: null,
    extra_headers: {},
  });
  assert.deepEqual(plain(buildSettingsPatch(
    valuesFromSettingsFormState(managedToManaged, {
      backend: "chatgpt-codex-responses",
      base_url: "ignored managed draft",
      credential_mode: "variable",
      api_key_env: "IGNORED_KEY",
    }),
    managedToManaged.initial,
  )), {
    base_url: "https://chatgpt.com/backend-api",
    backend: "chatgpt-codex-responses",
  });

  assert.deepEqual(plain(buildSettingsPatch(
    valuesFromSettingsFormState(managedToManaged, {
      backend: "arcee-api",
      base_url: "https://tenant.arcee.ai/api/v1",
      credential_mode: "variable",
      api_key_env: "ARCEE_API_KEY",
    }),
    managedToManaged.initial,
  )), {
    base_url: "https://tenant.arcee.ai/api/v1",
    backend: "arcee-api",
    api_key_env: "ARCEE_API_KEY",
  });

  assert.deepEqual(plain(buildSettingsPatch(settingsFixture({
    backend: "arcee-api",
  }), initialSettings)), {
    backend: "arcee-api",
  });

  assert.deepEqual(plain(buildSettingsPatch(settingsFixture({
    backend: "arcee-auth",
    base_url: "https://stale.example.test/v1",
    credential_mode: "variable",
    api_key_env: "STALE_API_KEY",
  }), initialSettings)), {
    base_url: "https://api.arcee.ai/api/v1",
    backend: "arcee-auth",
    api_key_env: null,
  });
});

test("settings malformed managed rows remain explicitly repairable", () => {
  const malformed = settingsFormStateFromMetadata({
    model: "managed-model",
    base_url: "https://old-api.example/v1",
    backend: "chatgpt-codex-responses",
    reasoning_effort: "ultra",
    api_key_env: " BAD KEY ",
    extra_headers_json: "{broken",
  });
  assert.equal(malformed.initial.extra_headers_invalid, true);
  assert.equal(malformed.baseUrlControl.restoreValue, "https://old-api.example/v1");
  assert.equal(malformed.credentialControl.restoreValue, " BAD KEY ");
  assert.deepEqual(plain(buildSettingsPatch(
    valuesFromSettingsFormState(malformed, {
      reasoning_effort: "medium",
      extra_headers: "",
    }),
    malformed.initial,
  )), {
    base_url: "https://chatgpt.com/backend-api",
    reasoning_effort: "medium",
    api_key_env: null,
    extra_headers: {},
  });
});

test("repeated settings modal openings reset drafts and ignore stale loads", () => {
  const first = settingsFormStateFromMetadata({
    model: "first",
    base_url: "https://old-api.example/v1",
    backend: "arcee-auth",
    api_key_env: "OLD_KEY",
    extra_headers: {},
  });
  assert.equal(first.baseUrlControl.readOnly, true);
  assert.equal(first.credentialControl.locked, true);

  const reopened = plain(settingsFormStateFromMetadata({
    model: "second",
    base_url: "https://new-api.example/v1",
    backend: "openai-responses",
    api_key_env: "NEW_KEY",
    extra_headers: {},
  }));
  assert.deepEqual(reopened.baseUrlControl, {
    value: "https://new-api.example/v1",
    readOnly: false,
    restoreValue: "https://new-api.example/v1",
  });
  assert.deepEqual(reopened.credentialControl, {
    mode: "variable",
    value: "NEW_KEY",
    locked: false,
    restoreMode: "variable",
    restoreValue: "NEW_KEY",
  });

  const showSource = appSource.match(/async function showSettingsOverlay[\s\S]*?\n}/)[0];
  const hideSource = appSource.match(/function hideSettingsOverlay[\s\S]*?\n}/)[0];
  assert.match(showSource, /requestGeneration !== state\.settingsRequestGeneration/);
  assert.match(showSource, /state\.selectedId !== sessionId/);
  assert.match(showSource, /el\.settingsOverlay\.hidden/);
  assert.match(hideSource, /state\.settingsRequestGeneration \+= 1/);
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
