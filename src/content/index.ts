// Content entry point. Injected on demand when a shortcut is pressed (nothing runs on pages
// otherwise) and exposes a tiny API that the background worker calls via chrome.scripting.

import type { Answer, ApplyResult, DetectResult, IndicatorMode, Question, StatusState } from '../shared/types';
import { pickAdapter } from './adapters';
import { applyAnswer } from './apply';
import { detectAll, detectCurrent, isAnswered, markHandled } from './detect';
import { inView } from './dom';
import { click } from './fill';
import { showStatus } from './indicator';
import { findNext } from './next';
import type { Detected } from './types';

let current: Detected | null = null;
/** Questions handed out by list(), addressed by index in applyAt/skipAt/reveal. */
let listed: Detected[] = [];

function describe(d: Detected): Question {
  const r = d.block.getBoundingClientRect();
  return { ...d.question, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, dpr: window.devicePixelRatio };
}
const gone: ApplyResult = { ok: false, message: 'The question is no longer on the page' };

const api = {
  /** Finds the one question to answer and returns it as plain data. */
  detect(): DetectResult {
    const hit = detectCurrent();
    current = hit?.d ?? null;
    if (!hit) return { found: false, score: 0 };
    if (!inView(hit.d.block)) hit.d.block.scrollIntoView?.({ block: 'center' });
    return { found: true, score: hit.score, question: describe(hit.d) };
  },
  async apply(answer: Answer): Promise<ApplyResult> {
    if (!current) return gone;
    const d = current;
    current = null;
    return applyAnswer(d, answer);
  },
  /** The model could not answer: remember that, so the next activation moves to the next question. */
  skip(): void {
    if (current) markHandled(current);
    current = null;
  },

  /** Every unanswered question on the page, in order (for the fill-page and fill-form modes). */
  list(): Question[] {
    listed = detectAll().filter((d) => !isAnswered(d));
    return listed.map((d) => d.question);
  },
  /** Scrolls a listed question into view and returns it with its on-screen rectangle (for screenshots). */
  reveal(index: number): Question | null {
    const d = listed[index];
    if (!d?.block.isConnected) return null;
    d.block.scrollIntoView?.({ block: 'center' });
    return describe(d);
  },
  async applyAt(index: number, answer: Answer): Promise<ApplyResult> {
    const d = listed[index];
    if (!d?.block.isConnected || isAnswered(d)) return gone;
    return applyAnswer(d, answer);
  },
  skipAt(index: number): void {
    if (listed[index]) markHandled(listed[index]);
  },
  /** Clicks the next-page control if there is one. Never clicks a submit control. */
  next(): boolean {
    const el = findNext(document, pickAdapter());
    if (el) click(el);
    return !!el;
  },
  /** Changes whenever the page shows different questions; used to tell whether "next" advanced. */
  signature(): string {
    return `${location.href}|${detectAll().map((d) => d.question.prompt.slice(0, 50)).join('|')}`;
  },

  status(state: StatusState, text: string, mode: IndicatorMode, force: boolean): void {
    showStatus(state, text, mode, force);
  },
};

export type PageApi = typeof api;
const g = globalThis as { __formPilot?: PageApi };
g.__formPilot ??= api; // re-injection keeps the existing instance and its state
