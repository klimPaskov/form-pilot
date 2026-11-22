// Development only: answers a question with the real Claude provider from Node, so a live page can
// be tested end to end (scripts/serve.mjs exposes this at POST /ask). The API key is read from
// config.local.json here and never enters the web page.
//   node_modules/.bin/esbuild scripts/ask.ts --bundle --platform=node --format=esm --outfile=.dev/ask.mjs

import fs from 'node:fs';
import { createAnthropicProvider } from '../src/ai/anthropic';
import type { ImageInput } from '../src/ai/provider';
import { fetchImage } from '../src/background/images';
import { DEFAULTS } from '../src/shared/settings';
import type { Answer, Question } from '../src/shared/types';

const key = JSON.parse(fs.readFileSync('config.local.json', 'utf8').replace(/^﻿/, '')).apiKey as string;
const provider = createAnthropicProvider();

// Some image hosts (Google Forms) refuse requests that do not look like a browser. Inside the
// extension Chrome supplies this header itself; from Node it has to be added.
const plainFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes('api.anthropic.com')) return plainFetch(input, init);
  return plainFetch(input, { ...init, headers: { ...(init.headers as object), 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' } });
}) as typeof fetch;
let plain = false;

export async function answer(q: Question): Promise<Answer & { imagesSent: number }> {
  const fetched = await Promise.all((q.images ?? []).map(fetchImage));
  const images = fetched.filter((i): i is ImageInput => !!i);
  const res = await provider.answer(q, images, { ...DEFAULTS, apiKey: key }, { plain });
  plain = res.plain;
  return { ...res.answer, imagesSent: images.length };
}
