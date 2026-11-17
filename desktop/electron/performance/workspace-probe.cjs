// The same function is evaluated in actual WKWebView and Electron documents.
// Fixture only: DOM/rAF and authenticated HTTP proxies, never physical paint or
// trusted terminal keyboard evidence. All records belong to disposable sessions.
async function nacWorkspaceProbe(config) {
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const repeats = Math.min(10, Math.max(1, config.repeats ?? 5));
  const results = { schema_version: 1, clock: 'performance.now', user_agent: navigator.userAgent,
    viewport: { innerWidth, innerHeight, devicePixelRatio }, visibility_state: document.visibilityState,
    proxy_only: true, typing_event_to_raf_ms: [], history_open_to_dom_raf_ms: [],
    scroll_frame_gaps_ms: [], streaming_dom_mutation_gaps_ms: [], terminal: [],
    session_ids: [], errors: [] };
  const wait = async (predicate, label, ms = 30000) => {
    const deadline = performance.now() + ms;
    while (performance.now() < deadline) {
      const value = await predicate();
      if (value) return value;
      await delay(20);
    }
    throw Error('Timed out: ' + label);
  };
  const api = async (route, data, method = data === undefined ? 'GET' : 'POST') => {
    const response = await fetch(route, { method,
      headers: { 'Content-Type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    if (!response.ok) throw Error(method + ' ' + route + ': ' + response.status);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
  const create = async () => {
    const result = await api('/sessions', { behavior: 'direct', backend: 'openai-responses',
      model: 'gpt-5.6-sol', base_url: config.providerURL, api_key_env: 'NAC_E2E_API_KEY',
      reasoning_effort: 'high', extra_headers: {}, orchestrator_compaction_threshold: 0 });
    results.session_ids.push(result.metadata.session_id);
    return result.metadata.session_id;
  };
  const composer = () => document.querySelector('[role=combobox][aria-label=Message]');
  const fill = value => {
    const element = composer();
    if (!(element instanceof HTMLTextAreaElement)) throw Error('Expected production textarea composer');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const navigate = async (session, tab = 'files') => {
    // A hash change is synchronous; React retirement is not. Leave an old
    // session through the ordinary home route before accepting another field.
    // Otherwise the predecessor's composer can satisfy readiness immediately.
    if (composer()) {
      location.hash = '/';
      await wait(() => !composer(), 'previous session composer retirement');
      await frame();
    }
    location.hash = '/session/' + session + '/' + tab;
    await wait(composer, 'current session composer');
    await frame();
  };
  const send = async (session, prompt, marker) => {
    fill(prompt);
    const button = await wait(() => document.querySelector('button[aria-label=Send]:not(:disabled)'), 'Send enabled');
    const began = performance.now();
    button.click();
    await wait(() => document.body.innerText.includes(marker), 'streamed marker', 60000);
    await wait(async () => !(await api('/sessions/' + session)).active_run, 'settled model run', 60000);
    await frame();
    return performance.now() - began;
  };
  const octal = text => [...new TextEncoder().encode(text)].map(n => '\\' + n.toString(8).padStart(3, '0')).join('');
  const history = await create();
  await navigate(history);
  results.history_seed_to_dom_ms = await send(history, config.historyPrompt, config.historyMarker);
  for (let index = 0; index < repeats; index++) {
    location.hash = '/';
    await wait(() => !composer(), 'prior history document retired');
    await frame();
    const began = performance.now();
    await navigate(history);
    await wait(() => document.body.innerText.includes(config.historyMarker), 'canonical history marker');
    await frame();
    results.history_open_to_dom_raf_ms.push(performance.now() - began);
  }
  const scroller = [...document.querySelectorAll('*')].filter(element =>
    element.scrollHeight > element.clientHeight + 100 && element.clientHeight > 200 &&
    ['auto', 'scroll'].includes(getComputedStyle(element).overflowY))
    .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  if (!scroller) throw Error('Expected real long-transcript scroll container');
  let last = performance.now();
  for (let index = 0; index < 120; index++) {
    scroller.scrollTop = index % 2 ? scroller.scrollHeight : 0;
    await frame();
    const now = performance.now();
    results.scroll_frame_gaps_ms.push(now - last);
    last = now;
  }
  scroller.scrollTop = scroller.scrollHeight;
  const typingTarget = composer();
  typingTarget.focus();
  await frame();
  results.typing_focus_metadata = { document_focused: document.hasFocus(),
    composer_focused: document.activeElement === typingTarget,
    visibility_state: document.visibilityState,
    target_tag: typingTarget.tagName, target_role: typingTarget.getAttribute('role') };
  if (!results.typing_focus_metadata.document_focused || !results.typing_focus_metadata.composer_focused) {
    throw Error('Focused typing proxy requires the current document and composer');
  }
  for (let index = 0; index < Math.min(1000, config.inputEvents ?? 200); index++) {
    if (composer() !== typingTarget || document.activeElement !== typingTarget) {
      throw Error('Typing target changed; no later input is replayed');
    }
    const began = performance.now();
    fill('bounded synthetic input ' + index);
    await frame();
    results.typing_event_to_raf_ms.push(performance.now() - began);
  }
  fill('');
  const stream = await create();
  await navigate(stream);
  let lastMutation = performance.now();
  const observer = new MutationObserver(() => {
    const now = performance.now();
    results.streaming_dom_mutation_gaps_ms.push(now - lastMutation);
    lastMutation = now;
  });
  observer.observe(document.getElementById('root'), { childList: true, characterData: true, subtree: true });
  try { results.stream_send_to_complete_dom_raf_ms = await send(stream, config.streamPrompt, config.streamMarker); }
  finally { observer.disconnect(); }
  const terminalSession = await create();
  await navigate(terminalSession, 'terminal');
  const region = () => document.querySelector('[aria-label="Session terminal"]');
  // The session drawer starts closed; the header's Session menu opens it on a
  // panel. Its rows carry a live fact after the name ("Terminal 1 running").
  const sessionMenu = () => document.querySelector('button[aria-label="Session menu"]');
  const oldEntry = () => document.querySelector('button[aria-label="Show panel"]');
  await wait(() => region() || sessionMenu() || oldEntry(), 'terminal panel entry');
  if (!region()) {
    // Keep the same probe usable against the retained pre-Focus baseline.
    if (oldEntry()) oldEntry().click();
    else {
      if (sessionMenu().getAttribute('aria-expanded') !== 'true') sessionMenu().click();
      (await wait(() => [...document.querySelectorAll('[role=dialog] button')].find(button =>
        /^Terminal(?![A-Za-z])/.test(button.textContent.trim()) && !button.disabled),
      'Session menu Terminal row')).click();
    }
  }
  await wait(region, 'terminal panel');
  const newShell = () => [...region().querySelectorAll('button')].find(button =>
    button.textContent.trim().toLowerCase() === 'new shell' && !button.disabled);
  if (!newShell()) region().querySelector('button[aria-label="Open list"]')?.click();
  (await wait(newShell, 'New shell')).click();
  await wait(() => region().innerText.includes('Connected') && region().querySelector('.xterm-rows'), 'connected visual terminal');
  const terminals = await api('/sessions/' + terminalSession + '/user-terminals');
  if (terminals.terminals.length !== 1) throw Error('Expected exactly one fixture terminal');
  const id = terminals.terminals[0].terminal_id;
  const prefix = '/sessions/' + terminalSession;
  const execution = prefix + '/executions/' + id;
  const terminal = prefix + '/user-terminals/' + id;
  const input = async bytes => {
    const control = await api(execution + '/input-control');
    const receipt = await api(execution + '/input', { protocol_version: 1,
      expected_revision: control.revision, bytes: [...bytes] });
    if (receipt.outcome !== 'written') throw Error('Fixture input uncertain; never replayed');
  };
  const command = text => input(new TextEncoder().encode(text + '\r'));
  const marker = async text => {
    await wait(() => region()?.querySelector('.xterm-rows')?.textContent.includes(text), 'visual terminal marker', 30000);
    await frame();
  };
  try {
    for (let index = 0; index < Math.min(repeats, 3); index++) {
      const row = { pressure_bytes_at_least: 4096 * 65 };
      const end = 'PERF_NOISE_END_' + index;
      let began = performance.now();
      await command("stty -echo; i=0; while [ $i -lt 4096 ]; do printf '%064d\\n' $i; i=$((i+1)); done; printf '" + octal('\n' + end + '\n') + "'");
      await marker(end);
      row.pressure_api_to_visual_dom_raf_ms = performance.now() - began;
      began = performance.now();
      await api(terminal + '/resize', { protocol_version: 1, cols: 90 + index, rows: 30 + index });
      await wait(async () => (await api(terminal)).cols === 90 + index, 'actual PTY resize');
      row.resize_api_to_status_ms = performance.now() - began;
      const sleeping = 'PERF_SLEEPING_' + index;
      await command("printf '" + octal(sleeping + '\n') + "'; sleep 30");
      await marker(sleeping);
      began = performance.now();
      await input(new Uint8Array([3]));
      const interrupted = 'PERF_INTERRUPTED_' + index;
      await command("printf '" + octal(interrupted + '\n') + "'");
      await marker(interrupted);
      row.interrupt_api_to_visual_dom_raf_ms = performance.now() - began;
      results.terminal.push(row);
    }
  } finally {
    const began = performance.now();
    await api(prefix + '/terminals/' + id, undefined, 'DELETE');
    await wait(async () => {
      const response = await fetch(terminal);
      if (response.status === 404) return true;
      if (!response.ok) throw Error('Terminal cleanup status: ' + response.status);
      const status = await response.json();
      return !status.alive && status.output_complete;
    }, 'terminal process/collector settlement', 30000);
    results.terminal_close_api_to_settled_ms = performance.now() - began;
  }
  location.hash = '/';
  await frame();
  return results;
}

if (typeof module !== 'undefined') module.exports = nacWorkspaceProbe;
