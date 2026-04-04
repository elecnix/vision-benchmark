import type { EvalResult, ModelResponse, GroundTruth, AngleGroundTruth, DotsGroundTruth, OCRGroundTruth } from '../types.js';

function extractNumbers(text: string): number[] {
  const m = text.match(/-?\d+\.?\d*/g);
  return m ? m.map(Number) : [];
}

function endOfQid(questionId: string): string {
  return questionId.split('|').pop() || '';
}

// ─── Angle scoring ──────────────────────────────────────────────────────────

function scoreAngle(response: string, questionId: string, gt: AngleGroundTruth): { score: number; dimensionScores: Record<string, number> } {
  const dims: Record<string, number> = {};
  const qType = endOfQid(questionId);
  if (qType === 'angle') {
    const nums = extractNumbers(response);
    if (!nums.length) return { score: 0, dimensionScores: { angle: 0 } };
    const guess = nums.find((n: number) => n >= 0 && n <= 180) ?? nums[0];
    const normExpected = Math.min(gt.angleDegrees % 180, 180 - (gt.angleDegrees % 180));
    const normGuess = Math.min(guess % 180, 180 - (guess % 180));
    const diff = Math.abs(normGuess - normExpected);
    dims.angle = diff <= 5 ? 1 : diff <= 15 ? 0.8 : diff <= 30 ? 0.5 : Math.max(0, 1 - diff / 90);
    return { score: dims.angle, dimensionScores: dims };
  }
  if (qType === 'length') {
    const lower = response.trim().toLowerCase();
    const expected = gt.barLength < 0.45 ? 'short' : gt.barLength > 0.75 ? 'long' : 'medium';
    dims.length = lower.includes(expected) ? 1 : 0;
    return { score: dims.length, dimensionScores: dims };
  }
  const lower = response.toLowerCase();
  let hits = 0;
  const lt = gt.lineType;
  if (lt === 'horizontal' && (lower.includes('horizont') || lower.includes('flat'))) hits++;
  else if (lt === 'vertical' && (lower.includes('vertic') || lower.includes('uprigh'))) hits++;
  else if (lt === 'diagonal' && (lower.includes('diagon') || lower.includes('slope'))) hits++;
  if (lower.split(/\s+/).length >= 8) hits++;
  if ((lt === 'horizontal' && lower.includes('horizontal')) || (lt === 'vertical' && lower.includes('vertical'))) hits += 0.5;
  dims.description = Math.min(1, hits / 2.5);
  return { score: dims.description, dimensionScores: dims };
}

// ─── Dots scoring ───────────────────────────────────────────────────────────

function scoreDots(response: string, questionId: string, gt: DotsGroundTruth): { score: number; dimensionScores: Record<string, number> } {
  const dims: Record<string, number> = {};
  const qType = endOfQid(questionId);
  if (qType === 'count') {
    const nums = extractNumbers(response);
    if (!nums.length) return { score: 0, dimensionScores: { count: 0 } };
    const guess = nums.find((n: number) => n > 0 && n <= 9999) ?? nums[0];
    const diff = Math.abs(guess - gt.dotCount);
    const pct = diff / Math.max(gt.dotCount, 1);
    dims.count = pct === 0 ? 1 : pct <= 0.05 ? 0.9 : pct <= 0.15 ? 0.7 : pct <= 0.3 ? 0.4 : 0;
    return { score: dims.count, dimensionScores: dims };
  }
  if (qType === 'colors') {
    const lower = response.toLowerCase();
    const colorKeywords = ['red', 'green', 'blue', 'orange', 'purple', 'yellow', 'cyan', 'pink', 'white', 'black', 'gray', 'grey'];
    const mentioned = colorKeywords.filter((c: string) => lower.includes(c));
    const uniqueColors = new Set(gt.dotPositions.map(p => {
      const r = p.color.toLowerCase();
      if (r.includes('255,0,0')) return 'red';
      if (r.includes('0,128,0')) return 'green';
      if (r.includes('0,0,255')) return 'blue';
      if (r.includes('255,165,0')) return 'orange';
      if (r.includes('128,0,128')) return 'purple';
      if (r.includes('255,255,0')) return 'yellow';
      if (r.includes('0,255,255')) return 'cyan';
      return r;
    }));
    const correct = mentioned.filter((c: string) => uniqueColors.has(c)).length;
    dims.colors = uniqueColors.size > 0 ? correct / uniqueColors.size : 0;
    return { score: dims.colors, dimensionScores: dims };
  }
  const lower = response.toLowerCase();
  let hits = 0;
  if (lower.includes('dot') || lower.includes('circ') || lower.includes('point') || lower.includes('sphere')) hits++;
  const nums = extractNumbers(response);
  if (nums.includes(gt.dotCount)) hits++;
  if (lower.includes('top') || lower.includes('bottom') || lower.includes('left') || lower.includes('right') || lower.includes('center')) hits++;
  dims.description = Math.min(1, hits / 3);
  return { score: dims.description, dimensionScores: dims };
}

// ─── OCR scoring ────────────────────────────────────────────────────────────

function scoreOCRRaw(response: string, gt: OCRGroundTruth): { score: number; dimensionScores: Record<string, number> } {
  const expected = gt.words.map(w => w.toLowerCase());
  const actual = response.toLowerCase().match(/[a-z0-9áéíóúàèìòùâêîôûäëïöü]+/g) || [];

  // Greedy in-order matching
  let matched = 0;
  let ai = 0;
  for (const ew of expected) {
    while (ai < actual.length && actual[ai] !== ew) ai++;
    if (ai < actual.length) { matched++; ai++; }
  }

  const accuracy = expected.length > 0 ? matched / expected.length : 0;
  const exactMatch = actual.length === expected.length && actual.every((w, i) => w === expected[i]);

  return {
    score: accuracy,
    dimensionScores: { ocr_accuracy: accuracy, ocr_exact: exactMatch ? 1 : 0 },
  };
}

// ─── Dispatch ───────────────────────────────────────────────────────────────

export function scoreResponse(response: ModelResponse, groundTruth: GroundTruth): EvalResult {
  let result: { score: number; dimensionScores: Record<string, number> };
  if (groundTruth.benchmark === 'angle') {
    result = scoreAngle(response.responseText, response.questionId, groundTruth as AngleGroundTruth);
  } else if (groundTruth.benchmark === 'dots') {
    result = scoreDots(response.responseText, response.questionId, groundTruth as DotsGroundTruth);
  } else {
    result = scoreOCRRaw(response.responseText, groundTruth as OCRGroundTruth);
  }
  return {
    sampleId: response.sampleId, questionId: response.questionId,
    modelId: response.modelId, provider: response.provider,
    groundTruthDescription: groundTruth.description,
    modelResponse: response.responseText, score: result.score,
    dimensionScores: result.dimensionScores,
    totalResponseTimeMs: response.totalResponseTimeMs, error: response.error,
  };
}
