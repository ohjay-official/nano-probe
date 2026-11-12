// Day-one probe: can a GitHub Actions Linux runner run Gemini Nano in real Chrome?
// Launches Chrome ourselves (no Playwright default args, which disable component
// updates and would block the model download), then drives it over CDP.
// Usage: node nano-probe.mjs <chrome-binary> <profile-dir> <out-dir> [timeoutMinutes]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const [chromeBin = 'google-chrome', profileDir = '/tmp/nano-profile', outDir = path.join(here, 'out'), timeoutArg = '35'] = process.argv.slice(2);
const timeoutMs = Number(timeoutArg) * 60_000;
await mkdir(outDir, { recursive: true });
await mkdir(profileDir, { recursive: true });

// Turn on the two chrome://flags entries by writing Local State before first launch.
// optimization-guide-on-device-model@2 = "Enabled BypassPerfRequirement"
// prompt-api-for-gemini-nano@1 = "Enabled"
const localStatePath = path.join(profileDir, 'Local State');
if (!existsSync(localStatePath)) {
  await writeFile(localStatePath, JSON.stringify({
    browser: { enabled_labs_experiments: ['optimization-guide-on-device-model@2', 'prompt-api-for-gemini-nano@1'] },
    internal_only_uis_enabled: true, // lets us screenshot chrome://on-device-internals as proof
  }));
}

const html = await readFile(path.join(here, 'page.html'));
const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); });
await new Promise((r) => server.listen(8123, '127.0.0.1', r));

const chrome = spawn(chromeBin, [
  `--user-data-dir=${profileDir}`,
  '--remote-debugging-port=9222',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1280,800',
  '--window-position=0,0',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let chromeLog = '';
chrome.stdout.on('data', (d) => { chromeLog += d; });
chrome.stderr.on('data', (d) => { chromeLog += d; });

async function waitForCdp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://127.0.0.1:9222/json/version'); if (r.ok) return r.json(); } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Chrome DevTools endpoint never came up');
}

const result = { startedAt: new Date().toISOString() };
let browser;
try {
  result.version = await waitForCdp();
  browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();
  await page.goto('http://127.0.0.1:8123/');
  await page.click('#go'); // real CDP input counts as user activation for LanguageModel.create()
  const deadline = Date.now() + timeoutMs;
  let lastSnap = 0;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => window.__probe);
    if (state?.done) break;
    if (Date.now() - lastSnap > 120_000) { // progress screenshot every 2 minutes
      await page.screenshot({ path: path.join(outDir, `progress-${Date.now()}.png`) });
      lastSnap = Date.now();
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  result.probe = await page.evaluate(() => window.__probe);
  await page.screenshot({ path: path.join(outDir, 'probe-page.png'), fullPage: true });
  try {
    const internals = await context.newPage();
    await internals.goto('chrome://on-device-internals');
    await internals.waitForTimeout(3000);
    await internals.screenshot({ path: path.join(outDir, 'on-device-internals.png'), fullPage: true });
    for (const tab of ['Model Status', 'Broker State', 'Event Logs']) {
      try {
        await internals.getByText(tab, { exact: true }).first().click({ timeout: 3000 });
        await internals.waitForTimeout(1500);
        await internals.screenshot({ path: path.join(outDir, `internals-${tab.replace(' ', '-').toLowerCase()}.png`), fullPage: true });
      } catch {}
    }
  } catch (e) { result.internalsError = String(e); }
} catch (e) {
  result.fatal = String(e && (e.stack || e));
} finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
  await writeFile(path.join(outDir, 'chrome.log'), chromeLog.slice(-20000));
  if (browser) await browser.close().catch(() => {});
  chrome.kill('SIGTERM');
  server.close();
}
const verdict = result.probe?.result || (result.fatal ? 'fatal' : 'timeout');
console.log('PROBE RESULT:', verdict);
if (result.probe?.answer) console.log('NANO SAID:', result.probe.answer);
if (result.fatal) console.log(result.fatal);
process.exit(verdict === 'on-device-ok' ? 0 : 1);
