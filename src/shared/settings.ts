import type { Settings } from './types';

// Replaced at build time with the key from config.local.json (empty if there is none).
declare const __BAKED_KEY__: string;
export const BAKED_KEY: string = typeof __BAKED_KEY__ !== 'undefined' ? __BAKED_KEY__ : '';

export const MODELS: { id: string; label: string }[] = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 (default)' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5 (fastest)' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-fable-5-2', label: 'Fable 5.2 (most capable)' },
];

export const DEFAULTS: Settings = {
  enabled: true,
  apiKey: '',
  model: 'claude-sonnet-5-5',
  effort: 'medium',
  explain: false,
  webSearch: true,
  indicator: 'minimal',
  visionFallback: true,
  touchButton: false,
  autoSocrative: true,
};

/** Stored settings over defaults; an empty stored key falls back to the baked-in one. */
export async function loadSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get('settings')).settings as Partial<Settings> | undefined;
  const s = { ...DEFAULTS, ...stored };
  if (!s.apiKey) s.apiKey = BAKED_KEY;
  return s;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const stored = (await chrome.storage.local.get('settings')).settings as Partial<Settings> | undefined;
  await chrome.storage.local.set({ settings: { ...stored, ...patch } });
}
