// Content entry point. Injected on demand when the shortcut is pressed (nothing runs on pages
// otherwise) and exposes a tiny API that the background worker calls via chrome.scripting.

import type { Answer, ApplyResult, DetectResult, IndicatorMode, StatusState } from '../shared/types';
import { applyAnswer } from './apply';
import { detectCurrent, markHandled } from './detect';
import { inView } from './dom';
import { showStatus } from './indicator';
import type { Detected } from './types';

let current: Detected | null = null;

const api = {
  /** Finds the one question to answer and returns it as plain data. */
  detect(): DetectResult {
    const hit = detectCurrent();
    current = hit?.d ?? null;
    if (!hit) return { found: false, score: 0 };
    if (!inView(hit.d.block)) hit.d.block.scrollIntoView?.({ block: 'center' });
    const r = hit.d.block.getBoundingClientRect();
    return {
      found: true,
      score: hit.score,
      question: { ...hit.d.question, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, dpr: window.devicePixelRatio },
    };
  },
  async apply(answer: Answer): Promise<ApplyResult> {
    if (!current) return { ok: false, message: 'The question is no longer on the page' };
    const d = current;
    current = null;
    return applyAnswer(d, answer);
  },
  /** The model could not answer: remember that, so the next activation moves to the next question. */
  skip(): void {
    if (current) markHandled(current);
    current = null;
  },
  status(state: StatusState, text: string, mode: IndicatorMode, force: boolean): void {
    showStatus(state, text, mode, force);
  },
};

export type PageApi = typeof api;
const g = globalThis as { __formPilot?: PageApi };
g.__formPilot ??= api; // re-injection keeps the existing instance and its state
