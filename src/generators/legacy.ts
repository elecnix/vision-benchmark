import { createCanvas } from 'canvas';
import type {
  Sample,
  AngleGroundTruth,
  DotsGroundTruth,
  AngleBenchmarkConfig,
  ColoredDotsBenchmarkConfig,
  DenseDotsBenchmarkConfig,
} from '../types.js';

// ─── Helpers for the old (now removed) angle/dot configs ──────────
// Kept for backward compat but new benchmarks use new configs below.

// ══════════════════════════════════════════════════════════════════
//  ANGLE BENCHMARK
// ══════════════════════════════════════════════════════════════════

/**
 * Generate line images at configurable angles and bar lengths.
 *
 * The bar is always centered and has a configurable length as a fraction
 * of the image diagonal.  Short bars have a small ratio; long bars span
 * nearly edge-to-edge.  Angles are generated in 10° increments by default.
 */
export function* generateAngleSamples(cfg: AngleBenchmarkConfig): Generator<Sample> {
  const sizes = cfg.sizes ?? [{ width: 256, height: 256 }];
  // Default: every 10 degrees, 0 through 170 (180+ is identical)
  const angleSteps = cfg.angleSteps ?? [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170];
  // Default bar lengths: short (0.3), medium (0.6), long (0.95)
  const barLengths = cfg.barLengths ?? [0.3, 0.6, 0.95];
  const colors = cfg.barColors ?? [[0, 0, 0]];
  const backgrounds = cfg.backgroundColors ?? [[255, 255, 255]];
  const lineWidths = cfg.lineWidths ?? [6];

  let n = 0;
  for (const size of sizes) {
    const diag = Math.sqrt(size.width ** 2 + size.height ** 2);
    for (const angle of angleSteps) {
      for (const frac of barLengths) {
        for (const color of colors) {
          for (const bg of backgrounds) {
            for (const lw of lineWidths) {
              const barLen = frac * diag;
              const half = barLen / 2;
              const rad = (angle * Math.PI) / 180;
              const dx = half * Math.cos(rad);
              const dy = half * Math.sin(rad);

              const lineType = angle === 0 ? 'horizontal' as const
                : angle === 90 ? 'vertical' as const
                : 'diagonal' as const;

              const desc = `${lineType === 'diagonal' ? `${angle}° diagonal` : lineType} bar, length ${(frac * 100).toFixed(0)}% of diagonal, centered on white ${size.width}×${size.height} canvas`;

              const sampleId = `angle-${String(angle).padStart(3,'0')}-len${(frac * 100).toFixed(0)}-${size.width}x${size.height}`;
              const gt: AngleGroundTruth = {
                benchmark: 'angle', sampleId, width: size.width, height: size.height,
                format: 'png', description: desc,
                angleDegrees: angle, barLength: frac, lineType, barColor: color,
                backgroundColor: bg, lineWidth: lw,
              };
              const canvas = renderAngle(gt, size);
              yield {
                id: `a-${String(n).padStart(4, '0')}|${sampleId}`,
                imageBase64: canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''),
                groundTruth: gt,
              };
              n++;
            }
          }
        }
      }
    }
  }
}

function renderAngle(gt: AngleGroundTruth, size: { width: number; height: number }) {
  const canvas = createCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = size;

  // Background
  ctx.fillStyle = `rgb(${gt.backgroundColor.join(',')})`;
  ctx.fillRect(0, 0, w, h);

  // Bar
  ctx.strokeStyle = `rgb(${gt.barColor.join(',')})`;
  ctx.lineWidth = gt.lineWidth;
  ctx.lineCap = 'round';

  const half = (gt.barLength * Math.sqrt(w * w + h * h)) / 2;
  const rad = (gt.angleDegrees * Math.PI) / 180;
  const dx = half * Math.cos(rad);
  const dy = half * Math.sin(rad);

  ctx.beginPath();
  ctx.moveTo(w / 2 - dx, h / 2 - dy);
  ctx.lineTo(w / 2 + dx, h / 2 + dy);
  ctx.stroke();

  return canvas;
}

// ══════════════════════════════════════════════════════════════════
//  COLORED DOTS BENCHMARK  (multicolored dots, one dot per position)
// ══════════════════════════════════════════════════════════════════

// Deterministic color palette
const COLOR_PALETTE: [number, number, number][] = [
  [255, 0, 0],   // red
  [0, 128, 0],   // green
  [0, 0, 255],   // blue
  [255, 165, 0], // orange
  [128, 0, 128], // purple
  [255, 255, 0], // yellow
  [0, 255, 255], // cyan
  [255, 20, 147],// deeppink
];

// Deterministic positions for scattered layouts (up to 8 dots)
const SCATTERED_POSITIONS: Array<{ x: number; y: number }>[] = [
  [{ x: 0.5, y: 0.5 }],
  [{ x: 0.25, y: 0.35 }, { x: 0.75, y: 0.65 }],
  [{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.35 }, { x: 0.5, y: 0.75 }],
  [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 }, { x: 0.25, y: 0.75 }, { x: 0.75, y: 0.75 }],
  [{ x: 0.15, y: 0.3 }, { x: 0.5, y: 0.15 }, { x: 0.85, y: 0.35 }, { x: 0.35, y: 0.75 }, { x: 0.65, y: 0.7 }],
  [{ x: 0.15, y: 0.3 }, { x: 0.5, y: 0.15 }, { x: 0.85, y: 0.35 }, { x: 0.15, y: 0.7 }, { x: 0.5, y: 0.85 }, { x: 0.85, y: 0.7 }],
  [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.1 }, { x: 0.9, y: 0.2 }, { x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, { x: 0.3, y: 0.8 }, { x: 0.7, y: 0.8 }],
  [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.1 }, { x: 0.9, y: 0.2 }, { x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, { x: 0.1, y: 0.8 }, { x: 0.5, y: 0.9 }, { x: 0.9, y: 0.8 }],
];

export function* generateColoredDotsSamples(cfg: ColoredDotsBenchmarkConfig): Generator<Sample> {
  const sizes = cfg.sizes ?? [{ width: 512, height: 512 }];
  const dotCounts = cfg.dotCounts ?? [1, 2, 3, 4, 5, 6];
  const dotRadii = cfg.dotRadii ?? [14];
  const backgrounds = cfg.backgroundColors ?? [[255, 255, 255]];
  const layout = cfg.layout ?? 'scattered';

  let n = 0;
  for (const size of sizes) {
    for (const count of dotCounts) {
      for (const radius of dotRadii) {
        for (const bg of backgrounds) {
          const positionsList = layout === 'grid'
            ? gridPositions(count, size)
            : (SCATTERED_POSITIONS[count - 1] ?? scatteredFallback(count, size));

          // Give each dot a distinct color from the palette
          const colors = COLOR_PALETTE.slice(0, count);

          const posDesc = positionsList.map((p, i) => `color${i}(${p.x.toFixed(2)},${p.y.toFixed(2)})`).join(' ');
          const sampleId = `cdots-${count}-r${radius}-${size.width}x${size.height}`;
          const gt: DotsGroundTruth = {
            benchmark: 'dots',
            sampleId,
            width: size.width,
            height: size.height,
            format: 'png',
            description: `${count} colored dots (radius ${radius}px) on white ${size.width}×${size.height} canvas. Colors: ${colors.map(c => `rgb(${c.join(',')})`).join(', ')}. Positions: ${posDesc}`,
            dotCount: count,
            dotRadius: radius,
            backgroundColor: bg,
            dotPositions: positionsList.map((p, i) => ({
              x: p.x,
              y: p.y,
              color: `rgb(${colors[i % colors.length].join(',')})`,
            })),
          };

          const canvas = createCanvas(size.width, size.height);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = `rgb(${bg.join(',')})`;
          ctx.fillRect(0, 0, size.width, size.height);

          for (const pos of gt.dotPositions) {
            ctx.beginPath();
            ctx.arc(pos.x * size.width, pos.y * size.height, radius, 0, Math.PI * 2);
            ctx.fillStyle = pos.color;
            ctx.fill();
          }

          yield {
            id: `cd-${String(n).padStart(4, '0')}|${sampleId}`,
            imageBase64: canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''),
            groundTruth: gt,
          };
          n++;
        }
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════
//  DENSE DOTS BENCHMARK  (many small black dots, counting challenge)
// ══════════════════════════════════════════════════════════════════

export function* generateDenseDotsSamples(cfg: DenseDotsBenchmarkConfig): Generator<Sample> {
  const sizes = cfg.sizes ?? [{ width: 512, height: 512 }];
  const dotCounts = cfg.dotCounts ?? [10, 20, 40, 80, 120, 200];
  const dotRadius = cfg.dotRadius ?? 4;
  const dotColor = cfg.dotColor ?? [0, 0, 0];
  const dotColorStr = `rgb(${dotColor.join(',')})`;
  const bgColor: [number, number, number] = [255, 255, 255];
  const margin = cfg.margin ?? 0.08;

  // Seeded RNG for deterministic positions
  function mulberry32(seed: number): () => number {
    return () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  let n = 0;
  for (const size of sizes) {
    for (const count of dotCounts) {
      const seed = count * 1000 + size.width * 7;
      const rng = mulberry32(seed);

      // Generate positions, avoiding exact overlaps
      const positions: Array<{ x: number; y: number }> = [];
      const minDist = dotRadius * 2 / Math.min(size.width, size.height) + 0.01;

      let attempts = 0;
      while (positions.length < count && attempts < count * 50) {
        const x = margin + rng() * (1 - 2 * margin);
        const y = margin + rng() * (1 - 2 * margin);
        const tooClose = positions.some(p =>
          Math.hypot(p.x - x, p.y - y) < minDist
        );
        if (!tooClose) {
          positions.push({ x, y });
        }
        attempts++;
      }

      // If we couldn't fit all, fill the rest with grid positions
      if (positions.length < count) {
        const remaining = count - positions.length;
        const grid = gridPositions(remaining, size, margin);
        for (const p of grid) {
          positions.push(p);
        }
      }

      const posSummary = positions.map(p => `(${p.x.toFixed(2)},${p.y.toFixed(2)})`).join(' ');
      const sampleId = `ddots-${count}-r${dotRadius}-${size.width}x${size.height}`;
      const gt: DotsGroundTruth = {
        benchmark: 'dots',
        sampleId,
        width: size.width,
        height: size.height,
        format: 'png',
        description: `${count} black dots (radius ${dotRadius}px) on white ${size.width}×${size.height} canvas`,
        dotCount: positions.length, // might be less than requested if overlap prevention kicked in
        dotRadius,
        backgroundColor: bgColor,
        dotPositions: positions.map(p => ({ x: p.x, y: p.y, color: dotColorStr })),
      };

      const canvas = createCanvas(size.width, size.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgb(255,255,255)';
      ctx.fillRect(0, 0, size.width, size.height);

      for (const pos of gt.dotPositions) {
        ctx.beginPath();
        ctx.arc(pos.x * size.width, pos.y * size.height, dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = dotColorStr;
        ctx.fill();
      }

      yield {
        id: `dd-${String(n).padStart(4, '0')}|${sampleId}`,
        imageBase64: canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''),
        groundTruth: gt,
      };
      n++;
    }
  }
}

// ─── Shared helpers ───────────────────────────────────────────────

function gridPositions(count: number, size: { width: number; height: number }, margin = 0.08): Array<{ x: number; y: number }> {
  const cols = Math.ceil(Math.sqrt(count * (size.width / size.height)));
  const rows = Math.ceil(count / cols);
  const positions: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    positions.push({
      x: margin + (1 - 2 * margin) * (col / Math.max(cols - 1, 1)),
      y: margin + (1 - 2 * margin) * (row / Math.max(rows - 1, 1)),
    });
  }
  return positions;
}

function scatteredFallback(count: number, size: { width: number; height: number }): Array<{ x: number; y: number }> {
  const margin = 0.15;
  const cols = Math.ceil(Math.sqrt(count * (size.width / size.height)));
  const rows = Math.ceil(count / cols);
  const positions: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    positions.push({
      x: margin + (1 - 2 * margin) * (col / Math.max(cols - 1, 1)),
      y: margin + (1 - 2 * margin) * (row / Math.max(rows - 1, 1)),
    });
  }
  return positions;
}
