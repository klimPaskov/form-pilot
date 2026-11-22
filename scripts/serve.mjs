// Tiny static server for the manual test page: node scripts/serve.mjs  ->  http://localhost:4173/test-pages/quiz.html
// If .dev/ask.mjs has been built (see scripts/ask.ts) it also serves POST /ask, which answers one
// question with the real Claude provider - used by the console harness to test live pages.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
// A page on the public web may only call this local server if the server opts in.
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-private-network': 'true',
};
const askPath = path.join(root, '.dev', 'ask.mjs');
const ask = fs.existsSync(askPath) ? (await import(pathToFileURL(askPath).href)).answer : null;

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    if (req.method === 'POST' && url.pathname === '/ask') {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        if (!ask) throw new Error('Build .dev/ask.mjs first (see scripts/ask.ts)');
        const answer = await ask(JSON.parse(body));
        res.writeHead(200, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(answer));
      } catch (e) {
        res.writeHead(500, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify({ error: String(e?.message ?? e) }));
      }
      return;
    }
    const file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { ...cors, 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(4173, () => console.log('http://localhost:4173/test-pages/quiz.html'));
