// The only UI on the page: a small dot in the corner (plus a short line of text when needed),
// isolated in a shadow root so the page cannot style it and it cannot disturb the page.

import type { IndicatorMode, StatusState } from '../shared/types';

const COLORS: Record<StatusState, string> = { working: '#8a8f98', ok: '#2e9e5b', low: '#d9930d', error: '#d64545' };
let host: HTMLElement | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

function hide(): void {
  clearTimeout(timer);
  host?.remove();
  host = undefined;
}

/** `force` shows the text even in minimal mode (answers that could not be filled in, explanations). */
export function showStatus(state: StatusState, text: string, mode: IndicatorMode, force = false): void {
  hide();
  const withText = !!text && (force || mode === 'full' || state === 'error');
  if (mode === 'off' && !(force && text)) return;

  host = document.createElement('div');
  host.setAttribute('data-form-pilot', '');
  host.style.cssText = 'all:initial;position:fixed;right:10px;bottom:10px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'closed' });
  const box = document.createElement('div');
  box.style.cssText =
    'display:flex;align-items:flex-start;gap:7px;max-width:320px;font:12px/1.4 system-ui,sans-serif;color:#1c1e21;cursor:pointer;' +
    (withText
      ? 'background:#fff;border:1px solid #d5d8dc;border-radius:8px;padding:6px 9px;box-shadow:0 2px 8px rgba(0,0,0,.12)'
      : '');
  const dot = document.createElement('span');
  dot.style.cssText = `flex:none;width:8px;height:8px;margin-top:${withText ? 4 : 0}px;border-radius:50%;background:${COLORS[state]}`;
  if (state === 'working') {
    dot.animate?.([{ opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }], { duration: 900, iterations: Infinity });
  }
  box.append(dot);
  if (withText) {
    const span = document.createElement('span');
    span.textContent = text;
    span.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere';
    box.append(span);
  }
  box.addEventListener('click', hide);
  root.append(box);
  document.documentElement.append(host);

  const ms = state === 'working' ? 90_000 : withText ? Math.min(20_000, 4000 + text.length * 50) : 1500;
  timer = setTimeout(hide, ms);
}
