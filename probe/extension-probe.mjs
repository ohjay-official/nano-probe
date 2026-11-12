// Throwaway probe: load an MV3 extension into branded Google Chrome using
// CDP Extensions.loadUnpacked over --remote-debugging-pipe (not --load-extension,
// which branded Chrome removed in 137), then open the side panel page and run
// Firebase AI Logic hybrid with an App Check debug token.
//
// Usage: node extension-probe.mjs <chrome-binary> <profile-dir> <out-dir>
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const [chromeBin = 'google-chrome', profileDir = '/tmp/ext-profile', outDir = path.join(here, 'out-extension')] = process.argv.slice(2);
const extensionDir = path.resolve(here, 'extension');
await mkdir(outDir, { recursive: true });
await mkdir(profileDir, { recursive: true });

if (!existsSync(path.join(extensionDir, 'config.generated.js'))) {
  console.error('Missing extension/config.generated.js. Run write-extension-config.mjs first.');
  process.exit(1);
}
if (!existsSync(path.join(extensionDir, 'dist', 'sidepanel.js'))) {
  console.error('Missing extension/dist/sidepanel.js. Run npm run bundle:extension first.');
  process.exit(1);
}

const localStatePath = path.join(profileDir, 'Local State');
if (!existsSync(localStatePath)) {
  await writeFile(localStatePath, JSON.stringify({
    browser: { enabled_labs_experiments: ['optimization-guide-on-device-model@2', 'prompt-api-for-gemini-nano@1'] },
    internal_only_uis_enabled: true,
  }));
}

// Chrome reads CDP commands on fd 3 and writes responses on fd 4 when
// launched with --remote-debugging-pipe.
const chrome = spawn(chromeBin, [
  `--user-data-dir=${profileDir}`,
  '--remote-debugging-pipe',
  '--enable-unsafe-extension-debugging',
  '--remote-debugging-port=9222',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1280,800',
  '--window-position=0,0',
  'about:blank',
], {
  stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
});

let chromeLog = '';
chrome.stdout.on('data', (d) => { chromeLog += d; });
chrome.stderr.on('data', (d) => { chromeLog += d; });
chrome.on('exit', (code, signal) => {
  chromeLog += `\n[chrome exit code=${code} signal=${signal}]\n`;
});

const cdpIn = chrome.stdio[3];
const cdpOut = chrome.stdio[4];
if (!cdpIn || !cdpOut) {
  console.error('Chrome did not receive pipe fds 3 and 4. stdio setup failed.');
  chrome.kill('SIGTERM');
  process.exit(1);
}

function redact(s) {
  return String(s).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[redacted-token]');
}

async function loadUnpacked(absPath) {
  const id = 1337;
  const request = { id, method: 'Extensions.loadUnpacked', params: { path: absPath } };
  let pending = '';
  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Extensions.loadUnpacked timed out after 20s')), 20_000);
    const onData = (chunk) => {
      pending += chunk.toString('utf8');
      let end = pending.indexOf('\x00');
      while (end !== -1) {
        const whole = pending.slice(0, end);
        pending = pending.slice(end + 1);
        end = pending.indexOf('\x00');
        try {
          const msg = JSON.parse(whole);
          if (msg.id === id) {
            clearTimeout(timer);
            cdpOut.off('data', onData);
            resolve(msg);
          }
        } catch {
          // ignore incomplete or event frames that are not this response
        }
      }
    };
    cdpOut.on('data', onData);
    cdpOut.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    cdpIn.write(JSON.stringify(request) + '\x00');
  });
  if (response.error) {
    throw new Error('Extensions.loadUnpacked failed: ' + JSON.stringify(response.error));
  }
  if (!response.result?.id) {
    throw new Error('Extensions.loadUnpacked returned no extension id: ' + JSON.stringify(response));
  }
  return response.result.id;
}

async function waitForCdpPort() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9222/json/version');
      if (r.ok) return r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Chrome DevTools port 9222 never came up (pipe + port may not both be available)');
}

const result = {
  startedAt: new Date().toISOString(),
  method: 'Extensions.loadUnpacked over --remote-debugging-pipe with --enable-unsafe-extension-debugging and --remote-debugging-port',
  chromeBin,
};
let browser;
try {
  result.extensionId = await loadUnpacked(extensionDir);
  result.loadUnpacked = 'ok';
  console.log('Loaded unpacked extension id:', result.extensionId);

  result.version = await waitForCdpPort();
  browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const page = await context.newPage();
  const url = `chrome-extension://${result.extensionId}/sidepanel.html`;
  await page.goto(url);
  await page.click('#go');
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => window.__probe);
    if (state?.done) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  result.probe = await page.evaluate(() => window.__probe);
  await page.screenshot({ path: path.join(outDir, 'sidepanel.png'), fullPage: true });
} catch (e) {
  result.fatal = String(e && (e.stack || e));
} finally {
  result.finishedAt = new Date().toISOString();
  await writeFile(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
  await writeFile(path.join(outDir, 'chrome.log'), redact(chromeLog).slice(-20000));
  if (browser) await browser.close().catch(() => {});
  chrome.kill('SIGTERM');
}

const source = result.probe?.inferenceSource;
const verdict = result.probe?.result || (result.fatal ? 'fatal' : 'timeout');
console.log('EXTENSION PROBE RESULT:', verdict);
if (source) console.log('inferenceSource:', source);
if (result.fatal) console.log(result.fatal);
const ok = verdict === 'firebase-ai-logic-ok';
process.exit(ok ? 0 : 1);
