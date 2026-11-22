// Types shared by the page-side modules (content script) and the background worker.

export type Kind = 'single' | 'multi' | 'text' | 'longtext' | 'dropdown' | 'blanks' | 'matching';

/** A numbered option, row or column. `id` is 1-based and is what the model refers to. */
export interface Choice {
  id: number;
  label: string;
}

export interface QImage {
  url: string;
  caption: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One question, as plain data. This is everything that leaves the page. */
export interface Question {
  kind: Kind;
  prompt: string;
  options?: Choice[];
  /** Matching only: each row gets one of `options`. */
  rows?: Choice[];
  /** Fill-in-the-blank only: number of [n] markers in `prompt`. */
  blanks?: number;
  /** Hint for short answers, e.g. "number". */
  inputHint?: string;
  images?: QImage[];
  /** The question contains a canvas/SVG/inaccessible figure, so a screenshot crop is needed. */
  needsShot?: boolean;
  rect?: Rect;
  dpr?: number;
  site: string;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface Answer {
  answerable: boolean;
  confidence: Confidence;
  choices?: number[];
  texts?: string[];
  pairs?: { row: number; option: number }[];
  explanation?: string;
}

export interface DetectResult {
  found: boolean;
  /** Higher = more likely the question the user is working on (used to pick between frames). */
  score: number;
  question?: Question;
}

export interface ApplyResult {
  ok: boolean;
  message: string;
}

export type StatusState = 'working' | 'ok' | 'low' | 'error';
export type IndicatorMode = 'off' | 'minimal' | 'full';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface Settings {
  enabled: boolean;
  apiKey: string;
  model: string;
  effort: Effort;
  explain: boolean;
  webSearch: boolean;
  indicator: IndicatorMode;
  visionFallback: boolean;
  /** Floating on-page trigger for touch devices. */
  touchButton: boolean;
  /** Select the answer automatically whenever Socrative shows a new question. */
  autoSocrative: boolean;
}
