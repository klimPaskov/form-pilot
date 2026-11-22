// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createAnthropicProvider } from '../src/ai/anthropic';
import { answerSchema, parseAnswer, userText } from '../src/ai/prompt';
import { DEFAULTS } from '../src/shared/settings';
import type { Question } from '../src/shared/types';

const q: Question = {
  kind: 'single',
  site: 'generic',
  prompt: 'Capital of France?',
  options: [{ id: 1, label: 'Berlin' }, { id: 2, label: 'Paris' }],
};
const settings = { ...DEFAULTS, apiKey: 'test-key' };

const message = (text: string, stop_reason = 'end_turn'): Response =>
  new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: settings.model,
      content: text ? [{ type: 'text', text }] : [],
      stop_reason,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
const badRequest = (): Response =>
  new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'nope' } }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });

/** A fake fetch that replays canned responses and records request bodies. */
function fakeFetch(responses: (() => Response)[]) {
  const bodies: any[] = [];
  const fetch = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return responses[bodies.length - 1]();
  }) as typeof globalThis.fetch;
  return { fetch, bodies };
}

describe('request construction', () => {
  it('renders the question compactly', () => {
    expect(userText(q, false)).toBe(
      'Single choice - pick exactly one option.\nQuestion: Capital of France?\nOptions:\n1. Berlin\n2. Paris',
    );
  });

  it('only asks for the fields a question kind needs', () => {
    const keys = (kind: Question['kind'], explain = false) => Object.keys((answerSchema(kind, explain) as any).properties);
    expect(keys('single')).toEqual(['answerable', 'confidence', 'choices']);
    expect(keys('longtext')).toEqual(['answerable', 'confidence', 'texts']);
    expect(keys('matching', true)).toEqual(['answerable', 'confidence', 'pairs', 'explanation']);
  });

  it('parses a reply even when it is wrapped in prose', () => {
    expect(parseAnswer('Sure: {"answerable":true,"confidence":"low","choices":[2]}')).toEqual({
      answerable: true,
      confidence: 'low',
      choices: [2],
    });
  });
});

describe('Claude provider', () => {
  it('sends model, effort, schema and web search, and returns the parsed answer', async () => {
    const { fetch, bodies } = fakeFetch([() => message('{"answerable":true,"confidence":"high","choices":[2]}')]);
    const res = await createAnthropicProvider({ fetch }).answer(q, [], settings);
    expect(res).toEqual({ answer: { answerable: true, confidence: 'high', choices: [2] }, plain: false });
    expect(bodies[0].model).toBe('claude-sonnet-5-5');
    expect(bodies[0].output_config.effort).toBe('medium');
    expect(bodies[0].output_config.format.type).toBe('json_schema');
    expect(bodies[0].tools[0].type).toBe('web_search_20260209');
    expect(bodies[0].fallbacks).toBe('default');
  });

  it('puts images before the question text', async () => {
    const { fetch, bodies } = fakeFetch([() => message('{"answerable":true,"confidence":"high","choices":[1]}')]);
    await createAnthropicProvider({ fetch }).answer(q, [{ caption: 'Figure:', mediaType: 'image/png', data: 'AAAA' }], settings);
    expect(bodies[0].messages[0].content.map((b: any) => b.type)).toEqual(['text', 'image', 'text']);
  });

  it('retries once without optional features when the API rejects them', async () => {
    const { fetch, bodies } = fakeFetch([badRequest, () => message('{"answerable":true,"confidence":"high","choices":[2]}')]);
    const res = await createAnthropicProvider({ fetch }).answer(q, [], settings);
    expect(res.plain).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[1].tools).toBeUndefined();
    expect(bodies[1].fallbacks).toBeUndefined();
  });

  it('resumes a paused web-search turn', async () => {
    const { fetch, bodies } = fakeFetch([
      () => message('', 'pause_turn'),
      () => message('{"answerable":true,"confidence":"high","choices":[2]}'),
    ]);
    const res = await createAnthropicProvider({ fetch }).answer(q, [], settings);
    expect(res.answer.choices).toEqual([2]);
    expect(bodies[1].messages).toHaveLength(2);
  });

  it('reports refusals and bad keys as readable errors', async () => {
    const refused = fakeFetch([() => message('', 'refusal')]);
    await expect(createAnthropicProvider({ fetch: refused.fetch }).answer(q, [], settings)).rejects.toThrow('declined');
    const unauthorized = fakeFetch([
      () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'x' } }), { status: 401 }),
    ]);
    await expect(createAnthropicProvider({ fetch: unauthorized.fetch }).answer(q, [], settings)).rejects.toThrow('Invalid API key');
  });
});
