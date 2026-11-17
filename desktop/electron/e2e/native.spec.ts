import { test, expect, root, type Candidate } from './fixture';
import { openSettingsSection } from './focus-helpers';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { FAKE_DEVICE_CODE, ProviderDeviceAuthDouble } from '../../../crates/nac-server/web/e2e/provider-device-auth-double';

async function menu(c: Candidate, label: string) {
  await c.app.evaluate(({ Menu }, label) => {
    const walk = (items: any[]): any => {
      for (const item of items) {
        if (item.label === label) return item;
        if (item.submenu) { const found = walk(item.submenu.items); if (found) return found; }
      }
    };
    const item = walk(Menu.getApplicationMenu()!.items);
    if (!item) throw new Error(`Missing native menu item: ${label}`);
    item.click();
  }, label);
}

async function focusWindow(c: Candidate) {
  await c.app.evaluate(({ app, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus();
    app.focus({ steal: true });
  });
  await expect.poll(() => c.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused())).toBe(true);
  await expect.poll(() => c.page.evaluate(() => document.hasFocus())).toBe(true);
}

async function focusWorkspace(c: Candidate) {
  await focusWindow(c);
  await c.page.locator('button:visible').first().focus();
}

test('native menu commands enter existing React flows and retain editor/modal guards', async ({ candidate: c }) => {
  expect(await c.page.evaluate(() => ({
    require: typeof (window as any).require, process: typeof (window as any).process,
    desktop: Object.keys((window as any).__nacDesktop ?? {}).sort(),
    paths: Object.keys((window as any).__nacLocalPaths ?? {}),
  }))).toEqual({ require: 'undefined', process: 'undefined',
    desktop: ['connect', 'connectLifetime', 'connectVisibility', 'reportConnectionLost'], paths: ['chooseDirectory'] });
  await focusWorkspace(c);
  await menu(c, 'Settings…');
  await expect(c.page.getByRole('main', { name: 'Models & providers', exact: true })).toBeVisible();
  await c.page.keyboard.press('Escape');
  await expect(c.page.getByRole('main', { name: 'Models & providers', exact: true })).toHaveCount(0);
  await focusWorkspace(c);
  await c.page.evaluate(() => document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await menu(c, 'Settings…');
  await expect(c.page.getByRole('main', { name: 'Models & providers', exact: true })).toHaveCount(0);
  await c.page.evaluate(() => document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await focusWorkspace(c);
  await menu(c, 'New Chat');
  // Unified creation lands on Home; an empty profile chooses its first project there.
  await expect(c.page.getByRole('heading', { name: 'Add a project', exact: true })).toBeVisible();
  await c.page.getByRole('button', { name: 'Get Started', exact: true }).click();
  const projectForm = c.page.getByRole('dialog', { name: 'New Project', exact: true });
  await expect(projectForm).toBeVisible();
  await projectForm.locator('input').first().focus();
  await menu(c, 'Settings…');
  await expect(c.page.getByRole('main', { name: 'Models & providers', exact: true })).toHaveCount(0);
  await expect(projectForm).toBeVisible();
  await c.page.keyboard.press('Escape');
  const project = await c.project();
  const session = await c.session('direct', project);
  await c.page.evaluate(id => { location.hash = `/session/${id}/files`; }, session);
  const composer = c.page.getByRole('combobox', { name: 'Message' });
  await expect(composer).toBeVisible();
  await composer.fill('Retained editor draft');
  await menu(c, 'Settings…');
  await expect(c.page.getByRole('main', { name: 'Models & providers', exact: true })).toHaveCount(0);
  await expect(composer).toHaveValue('Retained editor draft');
  await focusWorkspace(c);
  await menu(c, 'Projects…');
  await expect.poll(() => c.page.evaluate(() => location.hash)).toBe('#/');
});

test('actual preload admits trusted external anchors while rejecting wrong frames and stale documents', async ({ candidate: c }) => {
  // This controller observes IPC inside Electron main, never adds a renderer
  // bridge, and replaces only the OS opener for a deterministic handoff double.
  await c.app.evaluate(({ ipcMain, shell }) => {
    const probe = { binding: null as any, opened: [] as string[] };
    (globalThis as any).__nativeProbe = probe;
    ipcMain.on('nac:native', (_event, message) => {
      if (message?.kind === 'ready') probe.binding = { nonce: message.nonce, incarnation: message.incarnation };
    });
    shell.openExternal = async url => { probe.opened.push(url); };
  });
  await c.page.reload();
  await expect(c.page.getByText('No projects yet', { exact: true })).toBeVisible();
  await expect.poll(() => c.app.evaluate(() => !!(globalThis as any).__nativeProbe.binding)).toBe(true);
  const old = await c.app.evaluate(() => (globalThis as any).__nativeProbe.binding);
  await c.page.evaluate(() => {
    const frame = document.createElement('iframe'); frame.src = 'data:text/html,<p>foreign frame</p>'; document.body.append(frame);
  });
  await expect.poll(() => c.page.frames().length).toBe(2);
  const child = c.page.frames().find(frame => frame !== c.page.mainFrame())!;
  expect(await child.evaluate(() => ({
    native: typeof (window as any).__nacDesktop, paths: typeof (window as any).__nacLocalPaths,
    node: typeof (window as any).require,
  }))).toEqual({ native: 'undefined', paths: 'undefined', node: 'undefined' });
  await c.app.evaluate(({ BrowserWindow, ipcMain }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    const binding = (globalThis as any).__nativeProbe.binding;
    const message = { version: 1, kind: 'external_link', ...binding, request: 500, url: 'https://example.test/refused' };
    ipcMain.emit('nac:native', { sender: {}, senderFrame: contents.mainFrame }, message);
    ipcMain.emit('nac:native', { sender: contents, senderFrame: contents.mainFrame.frames[0] }, message);
    ipcMain.emit('nac:native', { sender: contents, senderFrame: contents.mainFrame }, { ...message, unexpected: true });
  });
  expect(await c.app.evaluate(() => (globalThis as any).__nativeProbe.opened)).toEqual([]);
  await c.page.reload();
  await expect(c.page.getByText('No projects yet', { exact: true })).toBeVisible();
  await expect.poll(() => c.app.evaluate(() => (globalThis as any).__nativeProbe.binding.nonce)).not.toBe(old.nonce);
  await c.app.evaluate(({ BrowserWindow, ipcMain }, binding) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    ipcMain.emit('nac:native', { sender: contents, senderFrame: contents.mainFrame }, {
      version: 1, kind: 'external_link', ...binding, request: 501, url: 'https://example.test/stale',
    });
  }, old);
  const href = 'https://example.test/authorize?state=opaque%2Bvalue%3D&redirect_uri=http%3A%2F%2Flocalhost%3A1456%2Fcallback';
  await c.page.evaluate(href => {
    const link = document.createElement('a'); link.href = href; link.target = '_blank'; link.textContent = 'Deliberate auth handoff';
    link.id = 'native-auth-link'; document.getElementById('root')!.append(link);
  }, href);
  await focusWindow(c);
  await c.page.locator('#native-auth-link').click();
  await expect.poll(() => c.app.evaluate(() => (globalThis as any).__nativeProbe.opened)).toEqual([href]);
  await c.page.evaluate(() => {
    window.open('https://example.test/scripted-popup', '_blank');
    const link = document.createElement('a'); link.href = 'file:///etc/passwd'; link.textContent = 'Unsafe link';
    link.id = 'native-unsafe-link'; document.getElementById('root')!.append(link);
  });
  await c.page.locator('#native-unsafe-link').click();
  await c.page.evaluate(() => { location.href = 'https://example.test/scripted-navigation'; });
  expect(new URL(c.page.url()).origin).toBe(c.endpoint);
  expect(c.app.windows()).toHaveLength(1);
  expect(await c.app.evaluate(() => (globalThis as any).__nativeProbe.opened)).toEqual([href]);
});

test('shared provider device sign-in requires a deliberate native browser handoff and retains the configuration draft', async ({ candidate: c }) => {
  const verificationUri = 'https://example.test/device?state=fake%2Bvalue%3D';
  const auth = await ProviderDeviceAuthDouble.install(c.page, c.endpoint, verificationUri);
  // Observe the real main/preload boundary and double only the OS opener.
  // No provider credentials, clipboard access or production bridge is involved.
  await c.app.evaluate(({ app, shell }) => {
    const actor = { opened: [] as string[], createdWindows: 0 };
    (globalThis as any).__providerAuthActor = actor;
    app.on('browser-window-created', () => { actor.createdWindows++; });
    shell.openExternal = async url => { actor.opened.push(url); };
  });
  await c.page.reload();
  await expect(c.page.getByText('No projects yet', { exact: true })).toBeVisible();
  await focusWorkspace(c);
  await menu(c, 'Settings…');
  const dialog = c.page.getByRole('main', { name: 'Models & providers', exact: true });
  await expect(dialog).toBeVisible();
  const draft = dialog.getByRole('textbox', { name: 'Configuration name', exact: true });
  await draft.fill('Electron draft survives sign-in');
  await dialog.getByRole('button', { name: 'OpenAI Responses', exact: true }).click();
  await c.page.getByRole('button', { name: 'ChatGPT Codex Responses', exact: true }).click();
  const account = dialog.getByRole('region', { name: 'Provider account', exact: true });
  await account.getByRole('button', { name: 'Sign in with ChatGPT', exact: true }).click();
  await expect(account.getByTestId('provider-device-code')).toHaveText(FAKE_DEVICE_CODE);
  const handoff = account.getByRole('link', { name: 'Open ChatGPT', exact: true });
  await expect(handoff).toHaveAttribute('href', verificationUri);
  // The shared flow's asynchronous window.open is refused. It neither opens
  // a privileged external window nor substitutes a system-browser handoff.
  expect(await c.app.evaluate(() => (globalThis as any).__providerAuthActor))
    .toEqual({ opened: [], createdWindows: 0 });
  expect(c.app.windows()).toHaveLength(1);
  expect(auth.starts).toEqual(['codex']);
  await focusWindow(c);
  await handoff.click();
  await expect.poll(() => c.app.evaluate(() => (globalThis as any).__providerAuthActor.opened))
    .toEqual([verificationUri]);
  auth.approve();
  await expect(account.getByText('Signed in', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(account.getByTestId('provider-device-code')).toHaveCount(0);
  await expect(draft).toHaveValue('Electron draft survives sign-in');
  await expect(dialog.getByRole('button', { name: 'ChatGPT Codex Responses', exact: true })).toBeVisible();
  expect(await c.app.evaluate(() => (globalThis as any).__providerAuthActor))
    .toEqual({ opened: [verificationUri], createdWindows: 0 });
  expect(c.app.windows()).toHaveLength(1);
  expect(auth.logouts).toEqual([]);
});

test('actual native folder panel cancels on hide and AbortSignal and reaps its exact helper', async ({ candidate: c }) => {
  const helperPids = () => execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8' }).split('\n')
    .map(line => line.trim().split(/\s+/)).filter(parts => Number(parts[1]) === c.app.process().pid && parts.slice(2).join(' ').endsWith('/native-folder-picker'))
    .map(parts => Number(parts[0]));
  const choose = async () => {
    await focusWorkspace(c);
    await c.page.evaluate(initial => {
      const controller = new AbortController();
      const state = { controller, settled: false, selected: undefined as string | null | undefined };
      (window as any).__folderTest = state;
      void (window as any).__nacLocalPaths.chooseDirectory(initial, controller.signal).then((value: string | null) => {
        state.settled = true; state.selected = value;
      });
    }, c.workspace);
    await expect.poll(helperPids).toHaveLength(1);
    const [pid] = helperPids(); c.ownedPids.push(pid);
    return pid;
  };
  await choose();
  await c.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  await expect.poll(() => c.page.evaluate(() => (window as any).__folderTest.settled)).toBe(true);
  expect(await c.page.evaluate(() => (window as any).__folderTest.selected)).toBeNull();
  await expect.poll(helperPids).toHaveLength(0);
  await choose();
  await c.page.evaluate(() => (window as any).__folderTest.controller.abort());
  await expect.poll(() => c.page.evaluate(() => (window as any).__folderTest.settled)).toBe(true);
  expect(await c.page.evaluate(() => (window as any).__folderTest.selected)).toBeNull();
  await expect.poll(helperPids).toHaveLength(0);
});

test('shared MCP OAuth UI preserves Rust PKCE success denial wrong-state and cancellation through the native handoff', async ({ candidate: c }) => {
  const fixture = spawn('python3', [path.join(root, 'desktop/macos/external_auth_fixture.py')], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH, PYTHONUNBUFFERED: '1' },
  });
  const lines = createInterface({ input: fixture.stdout });
  const exited = new Promise<number | null>((resolve, reject) => {
    fixture.once('error', reject); fixture.once('close', resolve);
  });
  const started = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Local auth double did not start')), 5000);
    lines.once('line', line => {
      clearTimeout(timeout);
      try { resolve(JSON.parse(line).origin); } catch { reject(new Error('Invalid local auth double receipt')); }
    });
    fixture.once('error', reject);
  });
  try {
    const auth = await started;
    await c.page.route('**/mcp_library/library', route => route.fulfill({ json: { entries: [] } }));
    // The actor consumes the existing fixture's external HTML/callback. It
    // establishes a deterministic opener handoff and real Rust PKCE ownership,
    // and makes no real browser/vendor or physical input claim.
    await c.app.evaluate(({ shell, ipcMain, BrowserWindow }) => {
      const actor = { opens: 0, callbackStatuses: [] as number[], failures: 0, nonce: '', uiReady: false,
        lastAttempt: null as null | { focused: boolean; visible: boolean; mainFrame: boolean } };
      (globalThis as any).__mcpAuthActor = actor;
      ipcMain.on('nac:native', (event, message) => {
        if (message?.kind === 'ready') { actor.nonce = message.nonce; actor.uiReady = false; }
        if (message?.nonce !== actor.nonce) return;
        if (message.kind === 'ui_ready') actor.uiReady = true;
        if (message.kind === 'ui_retired') actor.uiReady = false;
        if (message.kind === 'external_link') {
          const window = BrowserWindow.fromWebContents(event.sender);
          actor.lastAttempt = { focused: window?.isFocused() === true, visible: window?.isVisible() === true,
            mainFrame: event.senderFrame === event.sender.mainFrame };
        }
      });
      shell.openExternal = async url => {
        actor.opens++;
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error('Local authorization rejected');
          const html = await response.text();
          const callback = html.match(/location\.replace\(("(?:[^"\\]|\\.)*")\)/);
          if (callback) actor.callbackStatuses.push((await fetch(JSON.parse(callback[1]))).status);
        } catch { actor.failures++; }
      };
    });
    const credential = await c.api('/credentials', { value: 'electron-local-fixture-public-client' });
    await c.api('/mcp_library/servers', {
      name: 'external-auth-fixture', enabled: false, transport: 'streamable_http',
      url: `${auth}/mcp`, headers: {}, args: [], env: {},
    });
    for (const [index, mode] of ['success', 'denied', 'wrong-state', 'hold'].entries()) {
      await c.api('/mcp_library/servers/external-auth-fixture/oauth/configure', {
        registration: { type: 'pre_registered', client_id_credential: credential.name }, scopes: ['fixture:read'],
        authorization_metadata: {
          authorization_endpoint: `${auth}/oauth/authorize/${mode}`, token_endpoint: `${auth}/oauth/token`,
          issuer: auth, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'],
        },
      });
      await c.page.reload();
      const dialog = await openSettingsSection(c.page, 'MCP servers');
      await dialog.getByRole('button', { name: 'external-auth-fixture', exact: true }).click();
      await dialog.getByRole('button', { name: 'Authenticate', exact: true }).click();
      await expect(dialog.getByRole('status')).toHaveText('Waiting for authorization');
      await expect.poll(() => c.app.evaluate(() => (globalThis as any).__mcpAuthActor.uiReady)).toBe(true);
      await focusWindow(c);
      await dialog.getByRole('link', { name: 'Continue OAuth authorization', exact: true }).click();
      await expect.poll(() => c.app.evaluate(() => (globalThis as any).__mcpAuthActor.opens)).toBe(index + 1);
      expect(await c.app.evaluate(() => (globalThis as any).__mcpAuthActor.lastAttempt))
        .toEqual({ focused: true, visible: true, mainFrame: true });
      if (mode === 'success') await expect(dialog.getByRole('status')).toHaveText('Connected');
      else if (mode === 'denied') await expect(dialog.getByRole('status')).toHaveText('Authorization failed');
      else {
        if (mode === 'wrong-state') await expect.poll(() => c.app.evaluate(() => (globalThis as any).__mcpAuthActor.callbackStatuses.length)).toBe(3);
        await expect(dialog.getByRole('status')).toHaveText('Waiting for authorization');
        await dialog.getByRole('button', { name: 'Cancel authorization', exact: true }).click();
        await expect(dialog.getByRole('status')).toHaveText('Ready to connect');
      }
      expect(await c.app.evaluate(() => (globalThis as any).__mcpAuthActor.failures)).toBe(0);
      await c.api('/mcp_library/servers/external-auth-fixture/oauth/logout', {});
    }
    const evidence = await (await fetch(`${auth}/evidence`)).json();
    expect(evidence.tokens_issued).toBe(1);
    expect(evidence.events.filter((event: any) => event.kind === 'token_exchange')).toEqual([{ kind: 'token_exchange', pkce_verified: true }]);
    expect(evidence.events.filter((event: any) => event.kind === 'authorization').map((event: any) => event.mode))
      .toEqual(['success', 'denied', 'wrong-state', 'hold']);
  } finally {
    fixture.stdin.end('{"kind":"finish"}\n');
    const deadline = setTimeout(() => fixture.kill('SIGTERM'), 5000);
    try { expect(await exited).toBe(0); } finally { clearTimeout(deadline); lines.close(); }
  }
});
