// Settings popup. Optional: the extension works with its defaults without ever opening this.

import { BAKED_KEY, DEFAULTS, MODELS, saveSettings } from '../shared/settings';
import type { Settings } from '../shared/types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const CHECKS = ['enabled', 'explain', 'webSearch', 'visionFallback', 'touchButton'] as const;
const SELECTS = ['model', 'effort', 'indicator'] as const;

async function init(): Promise<void> {
  const stored = ((await chrome.storage.local.get('settings')).settings ?? {}) as Partial<Settings>;
  const s = { ...DEFAULTS, ...stored };

  const model = $<HTMLSelectElement>('model');
  const models = MODELS.some((m) => m.id === s.model) ? MODELS : [...MODELS, { id: s.model, label: s.model }];
  for (const m of models) model.add(new Option(m.label, m.id));

  for (const id of CHECKS) {
    const el = $<HTMLInputElement>(id);
    el.checked = s[id];
    el.addEventListener('change', () => void saveSettings({ [id]: el.checked }));
  }
  for (const id of SELECTS) {
    const el = $<HTMLSelectElement>(id);
    el.value = s[id];
    el.addEventListener('change', () => void saveSettings({ [id]: el.value }));
  }

  const key = $<HTMLInputElement>('apiKey');
  key.value = stored.apiKey ?? '';
  key.placeholder = BAKED_KEY ? 'built-in key' : 'sk-ant-...';
  $('keyNote').textContent = BAKED_KEY ? 'Leave empty to use the built-in key' : 'Stored only in this browser';
  key.addEventListener('change', () => void saveSettings({ apiKey: key.value.trim() }));

  for (const c of await chrome.commands.getAll()) {
    const el = document.getElementById('key-' + c.name);
    if (el) el.textContent = c.shortcut || 'not set';
  }
  // Chrome only lets shortcuts be changed on its own page.
  $('change').addEventListener('click', () => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
  for (const button of document.querySelectorAll<HTMLElement>('button[data-mode]')) {
    button.addEventListener('click', () => {
      void chrome.runtime.sendMessage({ type: 'answer', mode: button.dataset.mode });
      window.close();
    });
  }
}

void init();
