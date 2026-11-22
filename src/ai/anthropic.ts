// Claude provider, built on the official SDK (which supplies retries with backoff for 429/5xx and
// connection errors, timeouts, and typed errors).

import Anthropic from '@anthropic-ai/sdk';
import { answerSchema, parseAnswer, SYSTEM, userText } from './prompt';
import { ProviderError, type Provider } from './provider';

type Content = Anthropic.ContentBlockParam[];

function friendly(e: unknown): Error {
  if (e instanceof ProviderError) return e;
  if (e instanceof Anthropic.AuthenticationError) return new ProviderError('Invalid API key', true);
  if (e instanceof Anthropic.PermissionDeniedError) return new ProviderError('This API key cannot use that model', true);
  if (e instanceof Anthropic.NotFoundError) return new ProviderError('Model not found - check the model setting', true);
  if (e instanceof Anthropic.RateLimitError) return new ProviderError('Rate limited - try again in a moment');
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError('Claude took too long to answer');
  if (e instanceof Anthropic.APIConnectionError) return new ProviderError('Network error - could not reach Claude');
  if (e instanceof Anthropic.APIError) return new ProviderError(`Claude API error ${e.status ?? ''}: ${e.message}`.slice(0, 200));
  return e instanceof Error ? e : new Error(String(e));
}

export function createAnthropicProvider(deps: { fetch?: typeof fetch; maxRetries?: number } = {}): Provider {
  return {
    async answer(q, images, s, opts = {}) {
      const client = new Anthropic({
        apiKey: s.apiKey,
        dangerouslyAllowBrowser: true, // runs in the extension's own service worker, not in a web page
        maxRetries: deps.maxRetries ?? 2,
        timeout: 60_000,
        ...(deps.fetch && { fetch: deps.fetch }),
      });

      const content: Content = [];
      for (const img of images) {
        content.push({ type: 'text', text: img.caption });
        content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
      }
      content.push({ type: 'text', text: userText(q, s.explain) });

      const base = {
        model: s.model,
        max_tokens: 8000,
        system: SYSTEM,
        // Thinking stays adaptive (the default); effort is the speed/quality dial.
        output_config: { effort: s.effort, format: { type: 'json_schema' as const, schema: answerSchema(q.kind, s.explain) } },
      };

      const run = async (plain: boolean): Promise<Anthropic.Message | Anthropic.Beta.BetaMessage> => {
        const messages: Anthropic.MessageParam[] = [{ role: 'user', content }];
        for (let turn = 0; turn < 4; turn++) {
          const res = plain
            ? await client.messages.create({ ...base, messages })
            : await client.beta.messages.create({
                ...base,
                messages,
                // If a safety classifier declines, the API re-runs the request on a fallback model.
                betas: ['server-side-fallback-2026-07-01'],
                fallbacks: 'default',
                ...(s.webSearch && { tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 2 }] }),
              } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);
          // A server-side tool loop (web search) can pause; sending the turn back resumes it.
          if (res.stop_reason !== 'pause_turn') return res;
          messages.push({ role: 'assistant', content: res.content as Anthropic.ContentBlockParam[] });
        }
        throw new ProviderError('Claude did not finish answering');
      };

      let plain = !!opts.plain;
      let res: Awaited<ReturnType<typeof run>>;
      try {
        try {
          res = await run(plain);
        } catch (e) {
          // Web search or the fallback beta may be unavailable for this key/model: retry once without them.
          if (plain || !(e instanceof Anthropic.BadRequestError || e instanceof Anthropic.PermissionDeniedError)) throw e;
          plain = true;
          res = await run(true);
        }
      } catch (e) {
        throw friendly(e);
      }

      if (res.stop_reason === 'refusal') throw new ProviderError('Claude declined to answer this question');
      if (res.stop_reason === 'max_tokens') throw new ProviderError('The answer was cut off - try a lower effort setting');
      const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      return { answer: parseAnswer(text), plain };
    },
  };
}
