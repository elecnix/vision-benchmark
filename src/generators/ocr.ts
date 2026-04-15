import { createCanvas } from 'canvas';
import type { Sample, OCRGroundTruth, OCRBenchmarkConfig, OCRCase, OCRCaseType } from '../types.js';

// ─── Deterministic word generation ─────────────────────────────────────────

const WORD_POOL = [
  'blorpt', 'flimby', 'zarnok', 'quibble', 'dronk', 'wistle', 'ploxim',
  'snarve', 'trogun', 'vexill', 'ziffle', 'marnok', 'plonk', 'dribble',
  'frobbozz', 'gronkle', 'wompus', 'zantle', 'blixet', 'crunchem',
  'drofnats', 'flarble', 'grobble', 'hizzle', 'jarnak', 'knobble',
  'miffle', 'norgle', 'plopple', 'quonk', 'rizzle', 'snorfle', 'twonk',
  'vibble', 'wexile', 'xantor', 'yopple', 'zonkle', 'blipno', 'flarn',
  'glonk', 'hropt', 'jinkle', 'klorp', 'mizble', 'nackle', 'oxford',
  'pindle', 'qonk', 'rolble', 'sminx', 'tarple', 'urble', 'vintle',
  'whonk', 'xerbl', 'yindle', 'zopple', 'bleft', 'cromp', 'dringle',
  'fribble', 'glomk', 'hontle', 'joxle', 'krunble', 'marnix', 'nontle',
];

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateWords(count: number, seed: number): string[] {
  const rng = mulberry32(seed);
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    words.push(WORD_POOL[Math.floor(rng() * WORD_POOL.length)]);
  }
  return words;
}

// ─── Image rendering helpers ───────────────────────────────────────────────

function renderText(
  canvas: ReturnType<typeof createCanvas>,
  text: string,
  x: number, y: number,
  fontSize: number
) {
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontSize}px Arial, Helvetica, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#000000';
  ctx.fillText(text, x, y);
}

// ─── Case renderers ────────────────────────────────────────────────────────

function renderSingleSmall(canvas: ReturnType<typeof createCanvas>, word: string, w: number, h: number): number {
  const fontSize = Math.max(8, Math.floor(Math.min(w, h) * 0.04));
  const txt = word.toLowerCase();
  renderText(canvas, txt, (w - canvas.getContext('2d').measureText(txt).width) / 2, (h - fontSize) / 2, fontSize);
  return fontSize;
}

function renderSingleLarge(canvas: ReturnType<typeof createCanvas>, word: string, w: number, h: number): number {
  const fontSize = Math.max(24, Math.floor(Math.min(w, h) * 0.18));
  const txt = word.toLowerCase();
  renderText(canvas, txt, (w - canvas.getContext('2d').measureText(txt).width) / 2, (h - fontSize) / 2, fontSize);
  return fontSize;
}

function renderMulti(canvas: ReturnType<typeof createCanvas>, words: string[], w: number, h: number): number {
  const rng = mulberry32(42 + words.length);
  let fontSize = Math.max(10, Math.floor(Math.min(w, h) * (0.06 + rng() * 0.04)));
  // Place words in a grid-like layout with some randomness but ensure no overflow
  const cols = Math.ceil(Math.sqrt(words.length));
  const rows = Math.ceil(words.length / cols);
  const cellW = (w - 40) / cols;
  const cellH = (h - 40) / rows;
  // Shrink font if any word is wider than its cell
  const ctx = canvas.getContext('2d');
  for (let attempt = 0; attempt < 5; attempt++) {
    ctx.font = `${fontSize}px Arial, Helvetica, sans-serif`;
    let maxWordW = 0;
    for (const word of words) maxWordW = Math.max(maxWordW, ctx.measureText(word.toLowerCase()).width);
    if (maxWordW < cellW - 4) break;
    fontSize = Math.max(6, fontSize - 1);
  }
  let idx = 0;
  for (let r = 0; r < rows && idx < words.length; r++) {
    for (let c = 0; c < cols && idx < words.length; c++) {
      const word = words[idx].toLowerCase();
      ctx.font = `${fontSize}px Arial, Helvetica, sans-serif`;
      const lw = ctx.measureText(word).width;
      const cx = 20 + c * cellW + cellW / 2 - lw / 2 + (rng() - 0.5) * cellW * 0.2;
      const cy = 20 + r * cellH + cellH / 2 + (rng() - 0.5) * cellH * 0.2;
      renderText(canvas, word, Math.max(8, Math.min(cx, w - lw - 8)), cy, fontSize);
      idx++;
    }
  }
  return fontSize;
}

function renderParagraphColumn(canvas: ReturnType<typeof createCanvas>, words: string[], w: number, h: number, alignment: 'left' | 'center' | 'right'): number {
  const ctx = canvas.getContext('2d');
  // Calculate font size that fits all words within bounds
  // Start from default size, shrink if text overflows vertically
  let fontSize = Math.max(8, Math.floor(Math.min(w, h) * 0.045));
  const colWidth = w * 0.5;
  let x: number;
  if (alignment === 'left') x = 8;
  else if (alignment === 'center') x = (w - colWidth) / 2;
  else x = w - colWidth - 8;

  // Shrink font until all words fit vertically
  for (let attempt = 0; attempt < 5; attempt++) {
    ctx.font = `${fontSize}px Arial, Helvetica, sans-serif`;
    const lineHeight = fontSize * 1.25;
    const totalHeight = lineHeight * words.length + 16; // padding
    if (totalHeight <= h) break;
    fontSize = Math.max(6, fontSize - 1);
  }

  ctx.font = `${fontSize}px Arial, Helvetica, sans-serif`;
  const lineHeight = fontSize * 1.25;
  let y = Math.max(8, (h - lineHeight * words.length) / 2);
  for (let i = 0; i < words.length; i++) {
    const word = words[i].toLowerCase();
    const lw = ctx.measureText(word).width;
    if (alignment === 'center') {
      renderText(canvas, word, x + (colWidth - lw) / 2, y, fontSize);
    } else if (alignment === 'right') {
      renderText(canvas, word, x + colWidth - lw - 8, y, fontSize);
    } else {
      // Clip words that would overflow horizontally
      if (x + lw < w) {
        renderText(canvas, word, x, y, fontSize);
      }
    }
    y += lineHeight;
  }
  return fontSize;
}

function renderParagraphRow(canvas: ReturnType<typeof createCanvas>, words: string[], w: number, h: number, alignment: 'top' | 'bottom' | 'center'): number {
  // Wrap words into 2 rows so they fill horizontally
  let fontSize = Math.max(10, Math.floor(Math.min(w, h) * 0.045));
  const ctx = canvas.getContext('2d');
  const midIdx = Math.ceil(words.length / 2);
  const row1 = words.slice(0, midIdx);
  const row2 = words.slice(midIdx);

  // Shrink font until both rows fit within width
  for (let attempt = 0; attempt < 5; attempt++) {
    ctx.font = `${fontSize}px Arial, Helvetica, sans-serif`;
    const row1W = row1.reduce((s: number, word: string) => s + ctx.measureText(word.toLowerCase()).width, 0) + (row1.length - 1) * 10;
    const row2W = row2.reduce((s: number, word: string) => s + ctx.measureText(word.toLowerCase()).width, 0) + (row2.length - 1) * 10;
    if (Math.max(row1W, row2W) < w - 16) break;
    fontSize = Math.max(6, fontSize - 1);
  }
  ctx.font = `${fontSize}px Arial, Helvetica, sans-serif`;
  const lineHeight = fontSize * 1.5;

  function drawRow(ws: string[], y: number) {
    const totalW = ws.reduce((s: number, word: string) => s + ctx.measureText(word.toLowerCase()).width, 0) + (ws.length - 1) * 10;
    let x: number;
    if (alignment === 'top') x = 8;
    else if (alignment === 'center') x = (w - totalW) / 2;
    else x = w - totalW - 8;
    for (const word of ws) {
      renderText(canvas, word.toLowerCase(), x, y, fontSize);
      x += ctx.measureText(word.toLowerCase()).width + 10;
    }
  }

  let yStart: number;
  const totalH = lineHeight * 2;
  if (alignment === 'top') yStart = 12;
  else if (alignment === 'center') yStart = (h - totalH) / 2;
  else yStart = h - totalH - 12;

  drawRow(row1, yStart);
  drawRow(row2, yStart + lineHeight);
  return fontSize;
}

// ─── Main generator ────────────────────────────────────────────────────────

export function* generateOCRSamples(cfg: OCRBenchmarkConfig): Generator<Sample> {
  const sizes = cfg.sizes ?? [{ width: 512, height: 512 }];
  const fontColor = cfg.fontColor ?? [0, 0, 0];
  const bgColor = cfg.backgroundColor ?? [255, 255, 255];
  const seed = cfg.seed ?? 42;

  const defaultCases: OCRCase[] = [
    { type: 'single-small' },
    { type: 'single-large' },
    { type: 'multi-2' },
    { type: 'multi-3' },
    { type: 'multi-4' },
    { type: 'multi-5' },
    { type: 'paragraph-col-left' },
    { type: 'paragraph-col-center' },
    { type: 'paragraph-col-right' },
    { type: 'paragraph-row-top' },
    { type: 'paragraph-row-center' },
    { type: 'paragraph-row-bottom' },
  ];
  const cases = cfg.cases ?? defaultCases;

  let idx = 0;
  for (const size of sizes) {
    for (const case_ of cases) {
      const wordSeed = seed + idx;
      let words: string[];
      let fontSize: number;

      switch (case_.type) {
        case 'single-small': {
          words = generateWords(1, wordSeed);
          const canvas = createCanvas(size.width, size.height);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = `rgb(${bgColor.join(',')})`;
          ctx.fillRect(0, 0, size.width, size.height);
          fontSize = renderSingleSmall(canvas, words[0], size.width, size.height);
          yield makeSample(idx, case_.type, size, words, fontSize, canvas);
          break;
        }
        case 'single-large': {
          words = generateWords(1, wordSeed);
          const canvas = createCanvas(size.width, size.height);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = `rgb(${bgColor.join(',')})`;
          ctx.fillRect(0, 0, size.width, size.height);
          fontSize = renderSingleLarge(canvas, words[0], size.width, size.height);
          yield makeSample(idx, case_.type, size, words, fontSize, canvas);
          break;
        }
        case 'multi-2': case 'multi-3': case 'multi-4': case 'multi-5': {
          const count = parseInt(case_.type.split('-')[1]);
          words = generateWords(count, wordSeed);
          const canvas = createCanvas(size.width, size.height);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = `rgb(${bgColor.join(',')})`;
          ctx.fillRect(0, 0, size.width, size.height);
          fontSize = renderMulti(canvas, words, size.width, size.height);
          yield makeSample(idx, case_.type, size, words, fontSize, canvas);
          break;
        }
        case 'paragraph-col-left': case 'paragraph-col-center': case 'paragraph-col-right': {
          const align = case_.type.split('-').pop() as 'left' | 'center' | 'right';
          words = generateWords(15, wordSeed);
          const canvas = createCanvas(size.width, size.height);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = `rgb(${bgColor.join(',')})`;
          ctx.fillRect(0, 0, size.width, size.height);
          fontSize = renderParagraphColumn(canvas, words, size.width, size.height, align);
          yield makeSample(idx, case_.type, size, words, fontSize, canvas);
          break;
        }
        case 'paragraph-row-top': case 'paragraph-row-center': case 'paragraph-row-bottom': {
          const align = case_.type.split('-').pop() as 'top' | 'center' | 'bottom';
          words = generateWords(15, wordSeed);
          const canvas = createCanvas(size.width, size.height);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = `rgb(${bgColor.join(',')})`;
          ctx.fillRect(0, 0, size.width, size.height);
          fontSize = renderParagraphRow(canvas, words, size.width, size.height, align);
          yield makeSample(idx, case_.type, size, words, fontSize, canvas);
          break;
        }
      }
      idx++;
    }
  }
}

function makeSample(
  idx: number,
  caseType: OCRCaseType,
  size: { width: number; height: number },
  words: string[],
  fontSize: number,
  canvas: ReturnType<typeof createCanvas>
): Sample {
  const sampleId = `ocr-${caseType}-${size.width}x${size.height}`;
  const gt: OCRGroundTruth = {
    sampleId,
    benchmark: 'ocr',
    width: size.width,
    height: size.height,
    format: 'png',
    description: `${caseType}: ${size.width}×${size.height} canvas, ${words.length} words, ${fontSize}px font`,
    words,
    fontSize,
    fontFamily: 'Arial',
    fontStyle: caseType,
  };
  return {
    id: `ocr-${String(idx).padStart(3, '0')}|${sampleId}`,
    imageBase64: canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''),
    groundTruth: gt,
  };
}
