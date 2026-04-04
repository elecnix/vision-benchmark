/**
 * Input versioning & config fingerprinting.
 *
 * Every benchmark config is deterministically hashed. Results are cached
 * by (model, config_hash, sample_id, question_type).
 * If the config or image generation logic changes → new hash → cache miss → re-run.
 */

import { createHash } from 'node:crypto';

export const INPUT_VERSION = 'v1';

export function hashInput(value: unknown): string {
  const json = JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
  return createHash('sha256').update(json).digest('hex').slice(0, 10);
}

export const CODE_REPRO_API = `You will see an image that was generated using the drawing API below.
Write JavaScript code to reproduce this image as pixel-accurately as possible.

API (the functions are already in scope — just call them):
  fillRect(x, y, w, h, [r, g, b])          — filled rectangle
  fillCircle(cx, cy, radius, [r, g, b])     — filled circle
  drawLine(x1, y1, x2, y2, lineWidth, [r, g, b]) — line with round caps
  fillText(text, x, y, fontSize, [r, g, b]) — text, aligned top-left

Colors are [r, g, b] 0–255. Background is white (255,255,255).
Write only code, no explanations, no markdown fencing.`;
