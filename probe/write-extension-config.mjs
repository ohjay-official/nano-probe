// Writes extension/config.generated.js from environment variables.
// Never commit that file. Do not log secret values.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const required = [
  'FIREBASE_API_KEY',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_APP_ID',
  'FIREBASE_APPCHECK_DEBUG_TOKEN',
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error('Missing env vars:', missing.join(', '));
  process.exit(1);
}

const config = {
  firebase: {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.FIREBASE_APP_ID,
  },
  debugToken: process.env.FIREBASE_APPCHECK_DEBUG_TOKEN,
};

const out = path.join(here, 'extension', 'config.generated.js');
const body = `// Generated at probe time. Do not commit.\nexport default ${JSON.stringify(config, null, 2)};\n`;
await writeFile(out, body, 'utf8');
console.log('Wrote', out, 'for project', config.firebase.projectId);
