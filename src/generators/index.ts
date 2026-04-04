import { createCanvas } from 'canvas';
import type {
  AngleGroundTruth,
  DotsGroundTruth,
  Sample,
  AngleBenchmarkConfig,
  DotsBenchmarkConfig,
} from '../types.js';

function rgbToString([r, g, b]: [number, number, number]): string {
  return `rgb(${r},${g},${b})`;
}

/**
 * Angle benchmark image generator.
 * Produces images with bold lines at known angles on a solid background.
 */
export function* generateAngleSamples(config: AngleBenchmarkConfig): Generator<Sample> {
  const sizes = config.sizes ?? [{ width: 512, height: 512 }];
  const lineConfigs = config.lines ?? ['horizontal', 'vertical', 'diagonal-45', 'diagonal-135'];
  const lineColors = config.lineColors ?? [[0, 0, 0]];
  const bgColors = config.backgroundColors ?? [[255, 255, 255]];
  const lineWidths = config.lineWidths ?? [8];

  let sampleIndex = 0;

  for (const size of sizes) {
    for (const lineType of lineConfigs) {
      for (const lineColor of lineColors) {
        for (const bgColor of bgColors) {
          for (const lineWidth of lineWidths) {
            const { angleDegrees, description } = resolveLineType(lineType, size);

            const gt: AngleGroundTruth = {
              name: `angle-${lineType}-${size.width}x${size.height}-c${lineColor.join('')}-bg${bgColor.join('')}-w${lineWidth}`,
              benchmark: 'angle',
              width: size.width,
              height: size.height,
              format: 'png',
              lineType: lineType.includes('diagonal') ? 'diagonal' : (lineType as 'horizontal' | 'vertical'),
              angleDegrees,
              lineColor,
              backgroundColor: bgColor,
              lineWidth,
              description: description(size),
            };

            const canvas = createCanvas(size.width, size.height);
            const ctx = canvas.getContext('2d');

            // Fill background
            ctx.fillStyle = rgbToString(bgColor);
            ctx.fillRect(0, 0, size.width, size.height);

            // Draw the line
            ctx.strokeStyle = rgbToString(lineColor);
            ctx.lineWidth = lineWidth;
            ctx.lineCap = 'round';

            const { startX, startY, endX, endY } = computeLineEndpoints(lineType, size);
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();

            const imageBase64 = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
            const id = `angle-${sampleIndex.toString(16).padStart(4, '0')}|${gt.name}`;

            yield { id, imageBase64, groundTruth: gt };
            sampleIndex++;
          }
        }
      }
    }
  }
}

/**
 * Dots benchmark image generator.
 * Produces images with known numbers of dots at known positions.
 */
export function* generateDotsSamples(config: DotsBenchmarkConfig): Generator<Sample> {
  const sizes = config.sizes ?? [{ width: 512, height: 512 }];
  const dotCounts = config.dotCounts ?? [1, 2, 3, 4, 5];
  const dotRadii = config.dotRadii ?? [16];
  const dotColors = config.dotColors ?? [[255, 0, 0]];
  const bgColors = config.backgroundColors ?? [[255, 255, 255]];
  const layout = config.layout ?? 'scattered';

  let sampleIndex = 0;

  for (const size of sizes) {
    for (const count of dotCounts) {
      for (const dotRadius of dotRadii) {
        for (const dotColor of dotColors) {
          for (const bgColor of bgColors) {
            const positions = generateDotPositions(count, size, layout);
            const positionsStr = positions.map(p => `${(p.x * 100).toFixed(0)}%,${(p.y * 100).toFixed(0)}%`).join(';');

            const gt: DotsGroundTruth = {
              name: `dots-${count}-${size.width}x${size.height}-r${dotRadius}-c${dotColor.join('')}-bg${bgColor.join('')}-${layout}-p${stableHash(positionsStr)}`,
              benchmark: 'dots',
              width: size.width,
              height: size.height,
              format: 'png',
              dotCount: count,
              dotPositions: positions,
              dotRadius,
              dotColor,
              backgroundColor: bgColor,
              description: `A ${size.width}x${size.height} image with ${count} dot${count > 1 ? 's' : ''} (radius ${dotRadius}px, color rgb(${dotColor.join(',')})) on a rgb(${bgColor.join(',')}) background. Dot positions: ${positions.map(p => `x=${(p.x * 100).toFixed(1)}%, y=${(p.y * 100).toFixed(1)}%`).join(', ')}`,
            };

            const ctx = createCanvas(size.width, size.height).getContext('2d');
            ctx.fillStyle = rgbToString(bgColor);
            ctx.fillRect(0, 0, size.width, size.height);

            for (const pos of positions) {
              ctx.beginPath();
              ctx.arc(pos.x * size.width, pos.y * size.height, dotRadius, 0, Math.PI * 2);
              ctx.fillStyle = rgbToString(dotColor);
              ctx.fill();
            }

            const imageBase64 = ctx.canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
            const id = `dots-${sampleIndex.toString(16).padStart(4, '0')}|${gt.name}`;

            yield { id, imageBase64, groundTruth: gt };
            sampleIndex++;
          }
        }
      }
    }
  }
}

// ─── Line geometry helpers ────────────────────────────────────────────────

function resolveLineType(
  lineType: string,
  size: { width: number; height: number }
): { angleDegrees: number; description: (s: { width: number; height: number }) => string } {
  switch (lineType) {
    case 'horizontal':
      return {
        angleDegrees: 0,
        description: (s) => `A single bold horizontal line across the center of a ${s.width}x${s.height} image.`,
      };
    case 'vertical':
      return {
        angleDegrees: 90,
        description: (s) => `A single bold vertical line through the center of a ${s.width}x${s.height} image.`,
      };
    case 'diagonal-45': {
      const angle = Math.atan2(-size.height, size.width) * (180 / Math.PI);
      return {
        angleDegrees: Math.round(angle),
        description: (s) => `A single bold diagonal line from bottom-left to top-right at ${Math.round(angle)}° across a ${s.width}x${s.height} image.`,
      };
    }
    case 'diagonal-135': {
      const angle = Math.atan2(-size.height, -size.width) * (180 / Math.PI);
      return {
        angleDegrees: Math.round(angle),
        description: (s) => `A single bold diagonal line from top-left to bottom-right at ${Math.round(angle)}° across a ${s.width}x${s.height} image.`,
      };
    }
    default:
      throw new Error(`Unknown line type: ${lineType}`);
  }
}

function computeLineEndpoints(
  lineType: string,
  size: { width: number; height: number }
): { startX: number; startY: number; endX: number; endY: number } {
  const cx = size.width / 2;
  const cy = size.height / 2;

  switch (lineType) {
    case 'horizontal':
      return { startX: 0, startY: cy, endX: size.width, endY: cy };
    case 'vertical':
      return { startX: cx, startY: 0, endX: cx, endY: size.height };
    case 'diagonal-45':
      return { startX: 0, startY: size.height, endX: size.width, endY: 0 };
    case 'diagonal-135':
      return { startX: 0, startY: 0, endX: size.width, endY: size.height };
    default:
      throw new Error(`Unknown line type: ${lineType}`);
  }
}

// ─── Dot position helpers ─────────────────────────────────────────────────

function generateDotPositions(
  count: number,
  size: { width: number; height: number },
  layout: string
): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  const margin = 0.15; // keep dots within 15%-85% of each axis

  if (layout === 'scattered') {
    // Deterministic scattered positions using a simple LCG.
    const positionsByCount: Record<number, Array<{ x: number; y: number }>> = {
      1: [{ x: 0.5, y: 0.5 }],
      2: [{ x: 0.3, y: 0.4 }, { x: 0.7, y: 0.6 }],
      3: [{ x: 0.25, y: 0.3 }, { x: 0.75, y: 0.35 }, { x: 0.5, y: 0.75 }],
      4: [{ x: 0.25, y: 0.3 }, { x: 0.75, y: 0.3 }, { x: 0.25, y: 0.75 }, { x: 0.75, y: 0.75 }],
      5: [{ x: 0.2, y: 0.3 }, { x: 0.5, y: 0.2 }, { x: 0.8, y: 0.35 }, { x: 0.35, y: 0.7 }, { x: 0.65, y: 0.75 }],
      6: [{ x: 0.2, y: 0.3 }, { x: 0.5, y: 0.25 }, { x: 0.8, y: 0.3 }, { x: 0.2, y: 0.75 }, { x: 0.5, y: 0.7 }, { x: 0.8, y: 0.75 }],
      9: (() => {
        const pts: Array<{ x: number; y: number }> = [];
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 3; col++) {
            pts.push({
              x: margin + (1 - 2 * margin) * (col / 2),
              y: margin + (1 - 2 * margin) * (row / 2),
            });
          }
        }
        return pts;
      })(),
    };

    if (positionsByCount[count]) {
      return positionsByCount[count];
    }

    // Fallback: grid layout for arbitrary counts
    const cols = Math.ceil(Math.sqrt(count * (size.width / size.height)));
    const rows = Math.ceil(count / cols);
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      positions.push({
        x: margin + (1 - 2 * margin) * (col / Math.max(cols - 1, 1)),
        y: margin + (1 - 2 * margin) * (row / Math.max(rows - 1, 1)),
      });
    }
  } else if (layout === 'grid') {
    const cols = Math.ceil(Math.sqrt(count * (size.width / size.height)));
    const rows = Math.ceil(count / cols);
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      positions.push({
        x: margin + (1 - 2 * margin) * (col / Math.max(cols - 1, 1)),
        y: margin + (1 - 2 * margin) * (row / Math.max(rows - 1, 1)),
      });
    }
  } else {
    throw new Error(`Unknown dot layout: ${layout}`);
  }

  return positions;
}

/**
 * Deterministic hash to produce a stable short ID from a string.
 */
function stableHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).padStart(6, '0');
}
