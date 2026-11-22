// Image inputs for vision questions: fetch figures from the page, or crop a screenshot of the
// question when a figure cannot be fetched (canvas, SVG, blob URLs).

import type { ImageInput } from '../ai/provider';
import type { QImage, Rect } from '../shared/types';

const TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_BYTES = 3_500_000;

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function fetchImage(img: QImage): Promise<ImageInput | null> {
  try {
    const res = await fetch(img.url, { credentials: 'include', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!TYPES.has(blob.type) || blob.size > MAX_BYTES) return null;
    return { caption: img.caption, mediaType: blob.type as ImageInput['mediaType'], data: await toBase64(blob) };
  } catch {
    return null;
  }
}

/** Screenshot of the visible tab, cropped to `rect` (CSS pixels in the top frame) when given. */
export async function screenshot(windowId: number, caption: string, rect?: Rect, dpr = 1): Promise<ImageInput | null> {
  try {
    const url = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 80 });
    let blob = await (await fetch(url)).blob();
    if (rect && rect.w > 0 && rect.h > 0) {
      const bmp = await createImageBitmap(blob);
      const pad = 8;
      const x = Math.max(0, (rect.x - pad) * dpr);
      const y = Math.max(0, (rect.y - pad) * dpr);
      const w = Math.min(bmp.width - x, (rect.w + 2 * pad) * dpr);
      const h = Math.min(bmp.height - y, (rect.h + 2 * pad) * dpr);
      if (w > 20 && h > 20) {
        const canvas = new OffscreenCanvas(w, h);
        canvas.getContext('2d')!.drawImage(bmp, x, y, w, h, 0, 0, w, h);
        blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
      }
    }
    return { caption, mediaType: 'image/jpeg', data: await toBase64(blob) };
  } catch {
    return null;
  }
}
