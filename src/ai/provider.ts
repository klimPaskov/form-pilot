import type { Answer, Question, Settings } from '../shared/types';

export interface ImageInput {
  caption: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  /** Base64 without a data: prefix. */
  data: string;
}

export interface AskOptions {
  /** Skip optional request features (web search, refusal fallback) that the last call rejected. */
  plain?: boolean;
}

export interface AskResult {
  answer: Answer;
  /** True if the provider had to drop optional features; pass it back as `plain` next time. */
  plain: boolean;
}

/** The AI reasoning backend. Add a provider by implementing this one method. */
export interface Provider {
  answer(q: Question, images: ImageInput[], settings: Settings, opts?: AskOptions): Promise<AskResult>;
}

/** An error whose message is safe and useful to show to the user. */
export class ProviderError extends Error {}
