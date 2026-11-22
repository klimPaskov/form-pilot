// Builds the unpacked extension into dist/. `--zip` also writes form-pilot.zip.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Optional private key baked into the build so the extension works with zero setup.
const local = fs.existsSync('config.local.json') ? JSON.parse(fs.readFileSync('config.local.json', 'utf8').replace(/^﻿/, '')) : {};
// `--no-key` builds a copy that is safe to publish: the key is then entered in the popup instead.
const noKey = process.argv.includes('--no-key');
const apiKey = !noKey && typeof local.apiKey === 'string' && !local.apiKey.endsWith('...') ? local.apiKey : '';

fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist');

const common = {
  bundle: true,
  minify: true,
  target: 'chrome120',
  define: { __BAKED_KEY__: JSON.stringify(apiKey) },
  logLevel: 'info',
};
await build({ ...common, entryPoints: ['src/background/index.ts'], outfile: 'dist/background.js', format: 'esm' });
await build({ ...common, entryPoints: ['src/content/index.ts'], outfile: 'dist/content.js', format: 'iife' });
await build({ ...common, entryPoints: ['src/popup/popup.ts'], outfile: 'dist/popup.js', format: 'iife' });
await build({ ...common, entryPoints: ['src/content/touch.ts'], outfile: 'dist/touch.js', format: 'iife' });
await build({ ...common, entryPoints: ['src/content/watch.ts'], outfile: 'dist/watch.js', format: 'iife' });
for (const f of ['manifest.json', 'popup/popup.html']) fs.copyFileSync(`src/${f}`, `dist/${f.split('/').pop()}`);

console.log(apiKey ? 'API key baked in from config.local.json' : 'No baked API key (set one in the popup, or create config.local.json)');
if (process.argv.includes('--zip')) {
  fs.rmSync('form-pilot.zip', { force: true });
  // Windows' built-in bsdtar writes a real zip for a .zip name (GNU tar on PATH would not).
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'bsdtar';
  execFileSync(tar, ['-a', '-c', '-f', 'form-pilot.zip', '-C', 'dist', ...fs.readdirSync('dist')]);
  // A signed .crx for browsers that install from a file (e.g. Edge Canary on Android). The key is
  // created on first use and kept locally so the extension ID stays the same between builds.
  const { default: crx3 } = await import('crx3');
  await crx3(fs.readdirSync('dist').map((f) => `dist/${f}`), { keyPath: 'key.pem', crxPath: 'form-pilot.crx' });
  console.log('Wrote form-pilot.zip and form-pilot.crx');
}
