// Shortcut controller and orchestrator. One activation = detect one question, ask Claude once,
// fill one answer, stop. Nothing runs between activations.

import { createAnthropicProvider } from '../ai/anthropic';
import type { ImageInput, Provider } from '../ai/provider';
import type { PageApi } from '../content/index';
import { loadSettings, saveSettings } from '../shared/settings';
import type { Answer, ApplyResult, DetectResult, IndicatorMode, Question, Settings, StatusState } from '../shared/types';
import { fetchImage, screenshot } from './images';

const provider: Provider = createAnthropicProvider();
// Functions passed to executeScript are serialized and run in the page's isolated world, so they
// must be self-contained: each one reaches the injected module through globalThis.

// ---- single-flight guard: a second press while one is running (or just finished) is ignored ----------
let busy = false;
let lastEnd = 0;

chrome.commands.onCommand.addListener((command) => {
  if (command === 'answer') void activate();
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'answer') void activate();
});

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

async function activate(): Promise<void> {
  if (busy || Date.now() - lastEnd < 500) return;
  busy = true;
  try {
    await run();
  } finally {
    busy = false;
    lastEnd = Date.now();
  }
}

// ---- page access -------------------------------------------------------------------------------------

interface Frame<T> {
  frameId: number;
  result: T;
}

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

function badge(text: string, color = '#5f6368'): void {
  void chrome.action.setBadgeBackgroundColor({ color });
  void chrome.action.setBadgeText({ text });
  if (text && text !== '…') setTimeout(() => void chrome.action.setBadgeText({ text: '' }), 2500);
}

// ---- one activation --------------------------------------------------------------------------------

async function run(): Promise<void> {
  const settings = await loadSettings();
  if (!settings.enabled) return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !/^(https?|file):/.test(tab.url ?? '')) return badge('!', '#d64545');
  const tabId = tab.id;

  const status = (state: StatusState, text = '', force = false): void => {
    badge(state === 'working' ? '…' : state === 'error' ? '!' : '✓', state === 'error' ? '#d64545' : state === 'low' ? '#d9930d' : '#2e9e5b');
    inFrames(tabId, [0], (s: StatusState, t: string, m: IndicatorMode, f: boolean) => (globalThis as unknown as { __formPilot: PageApi }).__formPilot.status(s, t, m, f), [state, text, settings.indicator, force]).catch(() => {});
  };

  try {
    // Inject the page module on demand (a no-op if it is already there).
    try {
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    }
    if (!settings.apiKey) return status('error', 'No API key set - open the Form Pilot popup');

    const found = (await inFrames<DetectResult, []>(tabId, 'all', () => (globalThis as unknown as { __formPilot: PageApi }).__formPilot?.detect() ?? { found: false, score: 0 }, []))
      .filter((f) => f.result?.found)
      .sort((a, b) => b.result.score - a.result.score)[0];

    if (!found) return await visionOnly(settings, tab.windowId, status);
    const frameId = found.frameId;
    const q = found.result.question!;

    // Screenshot (if the question needs one) before the indicator appears, so it is not in the picture.
    const images = await collectImages(q, tab.windowId, frameId === 0);
    status('working');

    const answer = await ask(q, images, settings);
    if (!answer.answerable) {
      await inFrames(tabId, [frameId], () => (globalThis as unknown as { __formPilot: PageApi }).__formPilot.skip(), []);
      return status('error', 'No answer for this question - skipped', false);
    }
    const [applied] = await inFrames<ApplyResult, [Answer]>(tabId, [frameId], (a) => (globalThis as unknown as { __formPilot: PageApi }).__formPilot.apply(a), [answer]);
    if (!applied?.result.ok) return status('error', applied?.result.message ?? 'Could not fill in the answer');

    const low = answer.confidence === 'low';
    const text = [applied.result.message, low ? '(low confidence - check this one)' : '', settings.explain ? answer.explanation : '']
      .filter(Boolean)
      .join('\n');
    status(low ? 'low' : 'ok', text, low || (settings.explain && !!answer.explanation));
  } catch (e) {
    status('error', e instanceof Error ? e.message : String(e));
  }
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
  const res = await provider.answer(q, images, settings, { plain });
  if (res.plain && !plain) void chrome.storage.session.set({ [key]: true });
  return res.answer;
}

/** No form controls found: read the question from a screenshot and show the answer instead of filling it. */
async function visionOnly(
  settings: Settings,
  windowId: number,
  status: (state: StatusState, text?: string, force?: boolean) => void,
): Promise<void> {
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
