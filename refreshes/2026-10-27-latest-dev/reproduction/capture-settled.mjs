import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const served = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const require = createRequire(path.join(served.repo, 'crates/nac-server/web/package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true });
const output = path.join(served.output, 'captures');
await fs.mkdir(output, { recursive: false });
const manifest = { capturedAt: new Date().toISOString(), method: 'Unmodified exact committed bundles; actual disposable NAC backend; no API interception or DOM replacement.', captures: [] };
try {
  for (const scenario of served.scenarios) {
    for (const side of ['before', 'after']) {
      const revision = served.revisions.find((candidate) => candidate.key === scenario[side]);
      if (!revision) throw Error(`Unknown revision ${scenario[side]}`);
      const context = await browser.newContext({ viewport: scenario.viewport ?? { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: scenario.live ? 'no-preference' : 'reduce', serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const sessionId = revision.sessions[scenario.session ?? 'main'];
      const route = scenario.gallery ? '/design' : `/session/${sessionId}/${scenario.panel ?? 'files'}`;
      if (!scenario.gallery && !sessionId) throw Error(`Missing real session ${scenario.session ?? 'main'} for ${revision.key}`);
      await page.goto(`${revision.origin}/#${route}`, { waitUntil: 'domcontentloaded' });
      if (scenario.gallery) {
        const section = scenario.gallery[side];
        const heading = page.getByText(section, { exact: true }).first();
        await heading.waitFor({ state: 'visible' });
        await heading.scrollIntoViewIfNeeded();
      } else {
        await page.getByRole('combobox', { name: 'Message' }).or(page.getByText('Traditional coding agent', { exact: true })).first().waitFor({ state: 'visible' });
        await page.waitForTimeout(700);
        for (const step of scenario.steps ?? []) {
          if (step.side && step.side !== side) continue;
          const locator = step.role ? page.getByRole(step.role, { name: step.regex ? new RegExp(step.name) : step.name, exact: !step.regex }) : page.getByText(step.text, { exact: true });
          const target = locator.nth(step.index ?? 0);
          if (step.optional) { try { await target.waitFor({ state: 'visible', timeout: 1500 }); } catch { continue; } }
          if (step.action === 'scroll') await target.scrollIntoViewIfNeeded();
          else if (step.action === 'wheel') { await target.hover(); await page.mouse.wheel(0, step.deltaY ?? -180); }
          else await target.click();
        }
      }
      await page.evaluate(() => document.fonts.ready);
      // Permit debounced layout/panel transitions to settle without synthesizing application state.
      await page.waitForTimeout(700);
      const filename = `pr${scenario.pr}-${side}-${scenario.key}.jpg`;
      const destination = path.join(output, filename);
      const pixels = await page.screenshot({ type: 'jpeg', quality: 88, animations: scenario.live ? 'allow' : 'disabled' });
      await fs.writeFile(destination, pixels, { flag: 'wx' });
      const accessibility = await page.locator('body').ariaSnapshot();
      await fs.writeFile(destination.replace(/\.jpg$/, '.aria.txt'), accessibility);
      manifest.captures.push({ pr: scenario.pr, scenario: scenario.key, side, filename, frontendSha: revision.sha, assetTree: revision.assetTree, backendSha: revision.backendSha, backend: revision.backend, sessionId: sessionId ?? null, viewport: scenario.viewport ?? { width: 1440, height: 960 }, url: page.url(), sha256: createHash('sha256').update(pixels).digest('hex'), errors, note: scenario.note ?? '' });
      await context.close();
    }
  }
} finally {
  await browser.close();
  await fs.writeFile(path.join(served.output, 'capture-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
}
