import type { EvalResult, ModelResponse, GroundTruth, AngleGroundTruth, DotsGroundTruth } from '../types.js';

function extractNumbers(text: string): number[] {
  const m = text.match(/-?\d+\.?\d*/g);
  return m ? m.map(Number) : [];
}

function endOfQid(questionId: string): string {
  return questionId.split('|').pop() || '';  // describe, angle, length
}

function scoreAngle(response: string, questionId: string, gt: AngleGroundTruth): { score: number; dimensionScores: Record<string, number> } {
  const dims: Record<string, number> = {};
  const qType = endOfQid(questionId);

  if (qType === 'angle') {
    const nums = extractNumbers(response);
    if (!nums.length) { dims.angle = 0; return { score: 0, dimensionScores: dims }; }
    const guess = nums.find(n => n >= 0 && n <= 180) ?? nums[0];
    // Normalize both to 0-180 (a bar at 30° is the same as 210° = 30° after mod)
    // Also the model may report from the other axis: e.g. 150° for a 30° bar.
    // A bar has no direction, so θ and 180-θ are identical.
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

  // describe
  const lower = response.toLowerCase();
  let hits = 0;
  if (lineTypeWords(gt.lineType).some(w => lower.includes(w))) hits++;
  if (lower.split(/\s+/).length >= 8) hits++;
  if (gt.angleDegrees === 0 && lower.includes('horizontal') ||
      gt.angleDegrees === 90 && lower.includes('vertical')) hits += 0.5;
  dims.description = Math.min(1, hits / 2.5);
  return { score: dims.description, dimensionScores: dims };
}

function lineTypeWords(t: string): string[] {
  if (t === 'horizontal') return ['horizontal', 'flat', 'left to right'];
  if (t === 'vertical') return ['vertical', 'up', 'down', 'top to bottom'];
  return ['diagon', 'slope', 'tilt'];
}

function scoreDots(response: string, questionId: string, gt: DotsGroundTruth): { score: number; dimensionScores: Record<string, number> } {
  const dims: Record<string, number> = {};
  const qType = endOfQid(questionId);

  if (qType === 'count') {
    const nums = extractNumbers(response);
    if (!nums.length) { dims.count = 0; return { score: 0, dimensionScores: dims }; }
    const guess = nums.find(n => n > 0 && n <= 9999) ?? nums[0];
    const diff = Math.abs(guess - gt.dotCount);
    const pct = diff / Math.max(gt.dotCount, 1);
    dims.count = pct === 0 ? 1 : pct <= 0.05 ? 0.9 : pct <= 0.15 ? 0.7 : pct <= 0.3 ? 0.4 : 0;
    return { score: dims.count, dimensionScores: dims };
  }

  if (questionId.includes('|colors')) {
    const lower = response.toLowerCase();
    const colorKeywords = ['red', 'green', 'blue', 'orange', 'purple', 'yellow', 'cyan', 'pink', 'white', 'black', 'gray', 'grey'];
    const mentioned = colorKeywords.filter(c => lower.includes(c));
    const uniqueColors = new Set(gt.dotPositions.map(p => {
      const r = p.color.toLowerCase();
      if (r.includes('255,0,0')) return 'red';
      if (r.includes('0,128,0')) return 'green';
      if (r.includes('0,0,255')) return 'blue';
      if (r.includes('255,165,0')) return 'orange';
      if (r.includes('128,0,128')) return 'purple';
      if (r.includes('255,255,0')) return 'yellow';
      if (r.includes('0,255,255')) return 'cyan';
      if (r.includes('0,0,0')) return 'black';
      return r;
    }));
    const correct = mentioned.filter(c => uniqueColors.has(c)).length;
    dims.colors = uniqueColors.size > 0 ? correct / uniqueColors.size : 0;
    return { score: dims.colors, dimensionScores: dims };
  }

  // describe
  const lower = response.toLowerCase();
  let hits = 0;
  if (lower.includes('dot') || lower.includes('circ') || lower.includes('point') || lower.includes('sphere')) hits++;
  const nums = extractNumbers(response);
  if (nums.includes(gt.dotCount)) hits++;
  if (lower.includes('top') || lower.includes('bottom') || lower.includes('left') || lower.includes('right') || lower.includes('center')) hits++;
  dims.description = Math.min(1, hits / 3);
  return { score: dims.description, dimensionScores: dims };
}

export function scoreResponse(response: ModelResponse, groundTruth: GroundTruth): EvalResult {
  let result: { score: number; dimensionScores: Record<string, number> };
  if (groundTruth.benchmark === 'angle') {
    result = scoreAngle(response.responseText, response.questionId, groundTruth as AngleGroundTruth);
  } else {
    result = scoreDots(response.responseText, response.questionId, groundTruth as DotsGroundTruth);
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
