// Multi-question modes: fill every question on the page, or every page of the form. Kept free of
// chrome.* so it can be unit-tested against a fake page.

import type { ImageInput } from '../ai/provider';
import type { Answer, ApplyResult, Question } from '../shared/types';

/** Everything the runner needs from the page; implemented with chrome.scripting in the worker. */
export interface PageDriver {
  /** Unanswered questions per frame. */
  list(): Promise<{ frameId: number; questions: Question[] }[]>;
  images(frameId: number, index: number, q: Question): Promise<ImageInput[]>;
  applyAt(frameId: number, index: number, answer: Answer): Promise<ApplyResult>;
  skipAt(frameId: number, index: number): Promise<void>;
  /** Clicks the next-page control; false when there is none (last page). Never submits. */
  next(): Promise<boolean>;
  signature(): Promise<string>;
  /** Resolves once the page reached after next() is ready. */
  settle(): Promise<void>;
}

export interface RunControl {
  cancelled(): boolean;
  progress(done: number, total: number, page: number): void;
}

export interface RunReport {
  filled: number;
  skipped: number;
  failed: number;
  pages: number;
  /** Why the run ended early, if it did. */
  stopped?: string;
}

export type Ask = (q: Question, images: ImageInput[]) => Promise<Answer>;

/** Errors that will fail the same way for every question, so the run should end at once. */
export class FatalError extends Error {}

const CONCURRENCY = 3;
const MAX_PASSES = 3;
const MAX_PAGES = 40;

export async function fillPage(driver: PageDriver, ask: Ask, ctl: RunControl, report: RunReport): Promise<void> {
  // Answering can reveal follow-up questions, so look again until a pass fills nothing new.
  for (let pass = 0; pass < MAX_PASSES && !ctl.cancelled(); pass++) {
    const tasks = (await driver.list()).flatMap((f) => f.questions.map((q, index) => ({ frameId: f.frameId, index, q })));
    if (!tasks.length) return;
    const before = report.filled;
    let done = 0;

    // Screenshots need the question on screen, so image inputs are gathered one at a time, up front.
    const inputs: ImageInput[][] = [];
    for (const t of tasks) inputs.push(t.q.images?.length || t.q.needsShot ? await driver.images(t.frameId, t.index, t.q) : []);

    // Ask Claude about several questions at once, but touch the page for only one answer at a time.
    let pageLock: Promise<unknown> = Promise.resolve();
    const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
      const run = pageLock.then(fn, fn);
      pageLock = run.catch(() => {});
      return run;
    };
    let next = 0;
    let fatal: unknown;
    const worker = async (): Promise<void> => {
      while (next < tasks.length && !ctl.cancelled() && !fatal) {
        const i = next++;
        const t = tasks[i];
        try {
          const answer = await ask(t.q, inputs[i]);
          if (ctl.cancelled()) return;
          if (!answer.answerable) {
            await exclusive(() => driver.skipAt(t.frameId, t.index));
            report.skipped++;
          } else {
            const res = await exclusive(() => driver.applyAt(t.frameId, t.index, answer));
            if (res.ok) report.filled++;
            else {
              await exclusive(() => driver.skipAt(t.frameId, t.index));
              report.failed++;
            }
          }
        } catch (e) {
          if (e instanceof FatalError) fatal = e;
          else {
            await exclusive(() => driver.skipAt(t.frameId, t.index)).catch(() => {});
            report.failed++;
          }
        }
        ctl.progress(++done, tasks.length, report.pages);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));
    if (fatal) throw fatal;
    if (report.filled === before) return;
  }
}

/** Fills every page, pressing "next" between pages. Stops on the last page: submitting is the user's. */
export async function fillForm(driver: PageDriver, ask: Ask, ctl: RunControl, report: RunReport): Promise<void> {
  while (report.pages <= MAX_PAGES) {
    await fillPage(driver, ask, ctl, report);
    if (ctl.cancelled()) return;
    const before = await driver.signature();
    if (!(await driver.next())) return; // last page (or a single-page form)
    await driver.settle();
    if ((await driver.signature()) === before) {
      report.stopped = 'the page did not advance - a required question may need your answer';
      return;
    }
    report.pages++;
  }
}

export function summary(r: RunReport, cancelled: boolean): string {
  const parts = [`Filled ${r.filled} question${r.filled === 1 ? '' : 's'}`];
  if (r.pages > 1) parts[0] += ` on ${r.pages} pages`;
  if (r.skipped) parts.push(`${r.skipped} skipped`);
  if (r.failed) parts.push(`${r.failed} failed`);
  let text = parts.join(', ');
  if (cancelled) text += '. Stopped by you';
  else if (r.stopped) text += `. Stopped: ${r.stopped}`;
  return `${text}. Review, then submit yourself.`;
}
