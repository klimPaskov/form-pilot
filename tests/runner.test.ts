import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FatalError, fillForm, fillPage, summary, type Ask, type PageDriver, type RunReport } from '../src/background/runner';
import { applyAnswer } from '../src/content/apply';
import { detectAll, isAnswered, markHandled } from '../src/content/detect';
import { findNext } from '../src/content/next';
import type { Detected } from '../src/content/types';

const PAGES = [
  `<form><fieldset><legend>Question 1</legend><label><input type="radio" name="a"> A</label><label><input type="radio" name="a"> B</label></fieldset>
     <div><label for="t">Question 2</label><input id="t" type="text"></div>
     <div><p>Question 3</p><label><input type="checkbox" name="c"> X</label><label><input type="checkbox" name="c"> Y</label></div>
     <button type="button" id="next">Next</button></form>`,
  `<form><div><label for="u">Question 4</label><input id="u" type="text"></div><button type="submit" id="submit">Submit</button></form>`,
];

/** A PageDriver over the jsdom document, using the real detection and fill modules. */
function fakeSite(pages: string[], opts: { requireQ2?: boolean } = {}) {
  let page = 0;
  let listed: Detected[] = [];
  const submitted = vi.fn();
  const load = (): void => {
    document.body.innerHTML = pages[page];
    document.querySelector('form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      submitted();
    });
    document.getElementById('next')?.addEventListener('click', () => {
      if (opts.requireQ2 && !(document.getElementById('t') as HTMLInputElement).value) return; // validation blocks
      page++;
      load();
    });
  };
  load();
  const driver: PageDriver = {
    list: async () => {
      listed = detectAll(document, undefined).filter((d) => !isAnswered(d));
      return listed.length ? [{ frameId: 0, questions: listed.map((d) => d.question) }] : [];
    },
    images: async () => [],
    applyAt: async (_f, i, a) => applyAnswer(listed[i], a),
    skipAt: async (_f, i) => markHandled(listed[i]),
    next: async () => {
      const el = findNext(document, undefined);
      el?.click();
      return !!el;
    },
    signature: async () => `${page}|${detectAll(document, undefined).map((d) => d.question.prompt).join('|')}`,
    settle: async () => {},
  };
  return { driver, submitted, page: () => page };
}

const ctl = (cancelled = () => false) => ({ cancelled, progress: vi.fn() });
const newReport = (): RunReport => ({ filled: 0, skipped: 0, failed: 0, pages: 1 });
const ask: Ask = async (q) =>
  q.options
    ? { answerable: true, confidence: 'high', choices: [1] }
    : { answerable: true, confidence: 'high', texts: [`answer to ${q.prompt}`] };

beforeEach(() => void (document.body.innerHTML = ''));

describe('fill page', () => {
  it('answers every question on the page and does not leave the page', async () => {
    const site = fakeSite(PAGES);
    const report = newReport();
    await fillPage(site.driver, ask, ctl(), report);
    expect(report).toMatchObject({ filled: 3, skipped: 0, failed: 0 });
    expect(document.querySelectorAll('input:checked').length).toBe(2);
    expect((document.getElementById('t') as HTMLInputElement).value).toBe('answer to Question 2');
    expect(site.page()).toBe(0);
    expect(site.submitted).not.toHaveBeenCalled();
  });

  it('leaves existing answers alone', async () => {
    const site = fakeSite(PAGES);
    (document.getElementById('t') as HTMLInputElement).value = 'mine';
    const report = newReport();
    await fillPage(site.driver, ask, ctl(), report);
    expect(report.filled).toBe(2);
    expect((document.getElementById('t') as HTMLInputElement).value).toBe('mine');
  });

  it('counts unanswerable and failed questions and keeps going', async () => {
    const site = fakeSite(PAGES);
    const report = newReport();
    const flaky: Ask = async (q) => {
      if (q.prompt === 'Question 1') throw new Error('network');
      if (q.prompt === 'Question 2') return { answerable: false, confidence: 'low' };
      return ask(q, []);
    };
    await fillPage(site.driver, flaky, ctl(), report);
    expect(report).toMatchObject({ filled: 1, skipped: 1, failed: 1 });
  });

  it('stops at once on a fatal error and when cancelled', async () => {
    const site = fakeSite(PAGES);
    const bad: Ask = async () => Promise.reject(new FatalError('Invalid API key'));
    await expect(fillPage(site.driver, bad, ctl(), newReport())).rejects.toThrow('Invalid API key');
    const report = newReport();
    await fillPage(site.driver, ask, ctl(() => true), report);
    expect(report.filled).toBe(0);
  });
});

describe('fill form', () => {
  it('fills every page, presses next, and never submits', async () => {
    const site = fakeSite(PAGES);
    const report = newReport();
    await fillForm(site.driver, ask, ctl(), report);
    expect(report).toMatchObject({ filled: 4, pages: 2 });
    expect(report.stopped).toBeUndefined();
    expect(site.page()).toBe(1);
    expect((document.getElementById('u') as HTMLInputElement).value).toBe('answer to Question 4');
    expect(site.submitted).not.toHaveBeenCalled();
    expect(summary(report, false)).toBe('Filled 4 questions on 2 pages. Review, then submit yourself.');
  });

  it('stops when the page does not advance', async () => {
    const site = fakeSite(PAGES, { requireQ2: true });
    const report = newReport();
    const noQ2: Ask = async (q) => (q.prompt === 'Question 2' ? { answerable: false, confidence: 'low' } : ask(q, []));
    await fillForm(site.driver, noQ2, ctl(), report);
    expect(site.page()).toBe(0);
    expect(report.stopped).toContain('did not advance');
  });

  it('never treats a submit control as "next"', () => {
    document.body.innerHTML = `<button>Submit</button><button>Finish quiz</button><button>Send</button><div role="button">Submit answers</div>`;
    expect(findNext(document, undefined)).toBeNull();
    document.body.innerHTML = `<button>Back</button><button>Next</button><button>Submit</button>`;
    expect(findNext(document, undefined)?.textContent).toBe('Next');
  });
});
