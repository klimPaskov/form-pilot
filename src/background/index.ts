// Shortcut controller and orchestrator. Three modes, each started by its own shortcut:
//   one  - detect one question, ask Claude once, fill one answer, stop
//   page - fill every unanswered question on the open page
//   form - fill every page, pressing "next" between pages
// No mode ever submits a form, and nothing runs between activations.

import { createAnthropicProvider } from '../ai/anthropic';
import { ProviderError, type ImageInput, type Provider } from '../ai/provider';
import type { PageApi } from '../content/index';
import { loadSettings, saveSettings } from '../shared/settings';
import type { Answer, ApplyResult, DetectResult, IndicatorMode, Question, Settings, StatusState } from '../shared/types';
import { fetchImage, screenshot } from './images';
import { FatalError, fillForm, fillPage, summary, type PageDriver, type RunReport } from './runner';

type Mode = 'one' | 'page' | 'form';
type Status = (state: StatusState, text?: string, force?: boolean) => void;
const COMMANDS: Record<string, Mode> = { answer: 'one', 'answer-page': 'page', 'answer-form': 'form' };

const provider: Provider = createAnthropicProvider();

// ---- single-flight guard -----------------------------------------------------------------------------
// A second press while a single answer is in flight (or just finished) is ignored. While a page/form
// run is in progress, any shortcut press stops that run instead.
let busy: Mode | null = null;
let cancel = false;
let lastEnd = 0;

chrome.commands.onCommand.addListener((command) => {
  if (COMMANDS[command]) void activate(COMMANDS[command]);
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'answer') void activate(msg.mode === 'page' || msg.mode === 'form' ? msg.mode : 'one');
});

async function activate(mode: Mode): Promise<void> {
  if (busy) {
    if (busy !== 'one') cancel = true;
    return;
  }
  if (Date.now() - lastEnd < 500) return;
  busy = mode;
  cancel = false;
  try {
    await run(mode);
  } finally {
    busy = null;
    lastEnd = Date.now();
  }
}

// ---- floating trigger for touch devices (off on desktop, on by default on Android) -------------------
async function syncTouchButton(): Promise<void> {
  const { touchButton } = await loadSettings();
  const registered = (await chrome.scripting.getRegisteredContentScripts({ ids: ['touch'] })).length > 0;
  if (touchButton && !registered) {
    await chrome.scripting.registerContentScripts([{ id: 'touch', js: ['touch.js'], matches: ['<all_urls>'], runAt: 'document_idle' }]);
  } else if (!touchButton && registered) {
    await chrome.scripting.unregisterContentScripts({ ids: ['touch'] });
  }
}
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install' && /Android/i.test(navigator.userAgent)) await saveSettings({ touchButton: true });
  await syncTouchButton();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) void syncTouchButton();
});

// ---- page access -------------------------------------------------------------------------------------
// Functions passed to executeScript are serialized and run in the page's isolated world, so they
// must be self-contained: each one reaches the injected module through globalThis.

interface Frame<T> {
  frameId: number;
  result: T;
}
type G = { __formPilot: PageApi };

async function inFrames<T, A extends unknown[]>(
  tabId: number,
  frameIds: number[] | 'all',
  func: (...args: A) => T | Promise<T>,
  args: A,
): Promise<Frame<T>[]> {
  const target = frameIds === 'all' ? { tabId, allFrames: true } : { tabId, frameIds };
  const res = await chrome.scripting.executeScript({ target, func, args } as any);
  return res.map((r) => ({ frameId: r.frameId, result: r.result as T }));
}

/** Injects the page module on demand (a no-op where it is already present). */
async function inject(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  }
}

function badge(text: string, color = '#5f6368'): void {
  void chrome.action.setBadgeBackgroundColor({ color });
  void chrome.action.setBadgeText({ text });
  if (text && text !== '…') setTimeout(() => void chrome.action.setBadgeText({ text: '' }), 2500);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---- one activation ----------------------------------------------------------------------------------

async function run(mode: Mode): Promise<void> {
  const settings = await loadSettings();
  if (!settings.enabled) return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !/^(https?|file):/.test(tab.url ?? '')) return badge('!', '#d64545');
  const tabId = tab.id;

  const status: Status = (state, text = '', force = false) => {
    badge(state === 'working' ? '…' : state === 'error' ? '!' : '✓', state === 'error' ? '#d64545' : state === 'low' ? '#d9930d' : '#2e9e5b');
    inFrames(
      tabId,
      [0],
      (s: StatusState, t: string, m: IndicatorMode, f: boolean) => (globalThis as unknown as G).__formPilot.status(s, t, m, f),
      [state, text, settings.indicator, force],
    ).catch(() => {});
  };

  try {
    await inject(tabId);
    if (!settings.apiKey) return status('error', 'No API key set - open the Form Pilot popup');
    if (mode === 'one') await answerOne(settings, tabId, tab.windowId, status);
    else await answerMany(mode, settings, tabId, tab.windowId, status);
  } catch (e) {
    status('error', e instanceof Error ? e.message : String(e));
  }
}

async function answerOne(settings: Settings, tabId: number, windowId: number, status: Status): Promise<void> {
  const found = (
    await inFrames<DetectResult, []>(tabId, 'all', () => (globalThis as unknown as G).__formPilot?.detect() ?? { found: false, score: 0 }, [])
  )
    .filter((f) => f.result?.found)
    .sort((a, b) => b.result.score - a.result.score)[0];

  if (!found) return visionOnly(settings, windowId, status);
  const frameId = found.frameId;
  const q = found.result.question!;

  // Screenshot (if the question needs one) before the indicator appears, so it is not in the picture.
  const images = await collectImages(q, windowId, frameId === 0);
  status('working');

  const answer = await ask(q, images, settings);
  if (!answer.answerable) {
    await inFrames(tabId, [frameId], () => (globalThis as unknown as G).__formPilot.skip(), []);
    return status('error', 'No answer for this question - skipped');
  }
  const [applied] = await inFrames<ApplyResult, [Answer]>(tabId, [frameId], (a) => (globalThis as unknown as G).__formPilot.apply(a), [answer]);
  if (!applied?.result.ok) return status('error', applied?.result.message ?? 'Could not fill in the answer');

  const low = answer.confidence === 'low';
  const text = [applied.result.message, low ? '(low confidence - check this one)' : '', settings.explain ? answer.explanation : '']
    .filter(Boolean)
    .join('\n');
  status(low ? 'low' : 'ok', text, low || (settings.explain && !!answer.explanation));
}

/** Fill-page and fill-form modes; the loop itself lives in runner.ts. */
async function answerMany(mode: 'page' | 'form', settings: Settings, tabId: number, windowId: number, status: Status): Promise<void> {
  const driver: PageDriver = {
    list: async () =>
      (await inFrames<Question[], []>(tabId, 'all', () => (globalThis as unknown as G).__formPilot?.list() ?? [], []))
        .filter((f) => f.result?.length)
        .map((f) => ({ frameId: f.frameId, questions: f.result })),
    images: async (frameId, index, q) => {
      if (!q.needsShot) return collectImages(q, windowId, false);
      const [shown] = await inFrames<Question | null, [number]>(tabId, [frameId], (i) => (globalThis as unknown as G).__formPilot.reveal(i), [index]);
      await sleep(150); // let the scroll land before the screenshot
      return collectImages(shown?.result ?? q, windowId, frameId === 0);
    },
    applyAt: async (frameId, index, answer) =>
      (await inFrames<ApplyResult, [number, Answer]>(tabId, [frameId], (i, a) => (globalThis as unknown as G).__formPilot.applyAt(i, a), [index, answer]))[0]
        .result,
    skipAt: async (frameId, index) => {
      await inFrames(tabId, [frameId], (i: number) => (globalThis as unknown as G).__formPilot.skipAt(i), [index]);
    },
    next: async () => (await inFrames<boolean, []>(tabId, [0], () => (globalThis as unknown as G).__formPilot.next(), []))[0].result,
    signature: async () => (await inFrames<string, []>(tabId, [0], () => (globalThis as unknown as G).__formPilot.signature(), []))[0].result,
    settle: async () => {
      // "Next" may load a new document (Google Forms) or re-render in place; wait for either to finish.
      await sleep(900);
      for (let i = 0; i < 40 && (await chrome.tabs.get(tabId)).status !== 'complete'; i++) await sleep(250);
      await inject(tabId);
      await sleep(300);
    },
  };

  const report: RunReport = { filled: 0, skipped: 0, failed: 0, pages: 1 };
  status('working');
  const ctl = {
    cancelled: () => cancel,
    progress: (done: number, total: number, page: number) =>
      status('working', mode === 'form' ? `Page ${page}: ${done}/${total}` : `${done}/${total}`),
  };
  const answer = (q: Question, images: ImageInput[]): Promise<Answer> => ask(q, images, settings);
  if (mode === 'page') await fillPage(driver, answer, ctl, report);
  else await fillForm(driver, answer, ctl, report);

  if (!report.filled && !report.skipped && !report.failed) return status('error', 'No unanswered question found on this page');
  status(report.failed || report.stopped ? 'low' : 'ok', summary(report, cancel), true);
}

async function collectImages(q: Question, windowId: number, topFrame: boolean): Promise<ImageInput[]> {
  const fetched = await Promise.all((q.images ?? []).map(fetchImage));
  const images = fetched.filter((i): i is ImageInput => !!i);
  if (q.needsShot || images.length < fetched.length) {
    const shot = await screenshot(windowId, 'Screenshot of the question:', topFrame ? q.rect : undefined, q.dpr);
    if (shot) images.push(shot);
  }
  return images;
}

/** Remembers (for this browser session) that optional API features were rejected, to avoid a wasted call each time. */
async function ask(q: Question, images: ImageInput[], settings: Settings): Promise<Answer> {
  const key = `plain:${settings.model}`;
  const plain = !!(await chrome.storage.session.get(key))[key];
  try {
    const res = await provider.answer(q, images, settings, { plain });
    if (res.plain && !plain) void chrome.storage.session.set({ [key]: true });
    return res.answer;
  } catch (e) {
    // A bad key or model fails identically for every question: end a multi-question run at once.
    if (e instanceof ProviderError && e.fatal) throw new FatalError(e.message);
    throw e;
  }
}

/** No form controls found: read the question from a screenshot and show the answer instead of filling it. */
async function visionOnly(settings: Settings, windowId: number, status: Status): Promise<void> {
  if (!settings.visionFallback) return status('error', 'No unanswered question found on this page');
  const shot = await screenshot(windowId, 'Screenshot of the page:');
  if (!shot) return status('error', 'No unanswered question found on this page');
  status('working');
  const q: Question = {
    kind: 'text',
    site: 'screenshot',
    prompt:
      'Answer the question currently shown in the screenshot. If it is multiple choice, reply with the exact text of the correct option(s). If no question is visible, set answerable to false.',
  };
  const answer = await ask(q, [shot], settings);
  const text = answer.texts?.filter(Boolean).join('; ');
  if (!answer.answerable || !text) return status('error', 'No unanswered question found on this page');
  status(answer.confidence === 'low' ? 'low' : 'ok', [text, settings.explain ? answer.explanation : ''].filter(Boolean).join('\n'), true);
}
