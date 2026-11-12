// Source for the side panel probe. Bundled to dist/sidepanel.js in CI so
// Firebase stays a local script (Manifest V3 forbids remotely hosted code).
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, CustomProvider } from 'firebase/app-check';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
} from 'firebase/ai';
import config from './config.generated.js';

const out = { steps: [], ua: navigator.userAgent };
const logEl = document.getElementById('log');
function log(msg) {
  const line = new Date().toISOString().slice(11, 19) + '  ' + msg;
  out.steps.push(line);
  logEl.textContent = out.steps.join('\n');
}
window.__probe = out;

document.getElementById('go').addEventListener('click', async () => {
  try {
    // Official debug path: set this before initializeAppCheck.
    // https://firebase.google.com/docs/app-check/web/debug-provider
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = config.debugToken;

    const app = initializeApp(config.firebase);
    log('Firebase app initialized');

    // Do not use ReCaptchaV3Provider here. It loads external scripts, which
    // Manifest V3 will block, and reCAPTCHA keys are tied to website domains.
    // The debug token is the throwaway CI path. CustomProvider is only a
    // required constructor argument; the debug token should take over.
    initializeAppCheck(app, {
      provider: new CustomProvider({
        getToken: async () => {
          throw new Error('CustomProvider.getToken was called. The App Check debug token may not have been picked up.');
        },
      }),
      isTokenAutoRefreshEnabled: true,
    });
    log('App Check initialized with debug token path');

    const ai = getAI(app, { backend: new GoogleAIBackend() });
    const model = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
    });
    if (typeof model.initializeDeviceModel === 'function') {
      try {
        await model.initializeDeviceModel();
        log('initializeDeviceModel finished');
      } catch (e) {
        log('initializeDeviceModel threw (may be ok if Nano is missing): ' + String(e && e.message || e));
      }
    }

    const result = await model.generateContent(
      'Reply with the single word ok. No other text.',
    );
    const text = result.response.text();
    const source = result.response.inferenceSource;
    out.answer = text;
    out.inferenceSource = source || null;
    log('model reply: ' + text);
    log('inferenceSource: ' + String(source));

    // Cloud path: the real App Check test. On-device calls never hit the
    // backend, so only an in-cloud call proves the debug token is accepted
    // while App Check is enforced for Firebase AI Logic.
    try {
      const cloud = getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD });
      const cr = await cloud.generateContent('Reply with the single word ok. No other text.');
      out.cloudAnswer = cr.response.text();
      out.cloudSource = cr.response.inferenceSource || null;
      log('cloud reply: ' + out.cloudAnswer);
      log('cloud inferenceSource: ' + String(out.cloudSource));
      out.cloud = 'cloud-app-check-ok';
    } catch (e) {
      out.cloud = 'cloud-error';
      out.cloudError = String(e && (e.stack || e.message || e));
      log('CLOUD ERROR: ' + out.cloudError);
    }
    out.result = out.cloud === 'cloud-app-check-ok' ? 'firebase-ai-logic-ok' : 'on-device-ok-cloud-failed';
  } catch (err) {
    out.result = 'error';
    out.error = String(err && (err.stack || err.message || err));
    log('ERROR: ' + out.error);
  } finally {
    out.done = true;
    logEl.className = out.result === 'firebase-ai-logic-ok' ? 'ok' : 'bad';
  }
});
