import type { EvalResult, ModelResponse, GroundTruth, AngleGroundTruth, DotsGroundTruth } from '../types.js';

/**
 * Extract numbers from a text response.
 * Returns all integers/floats found.
 */
function extractNumbers(text: string): number[] {
  const matches = text.match(/-?\d+\.?\d*/g);
  return matches ? matches.map(Number) : [];
}

/**
 * Score an angle/line response against ground truth.
 */
function scoreAngle(
  response: string,
  questionId: string,
  gt: AngleGroundTruth
): { score: number; dimensionScores: Record<string, number> } {
  const scores: Record<string, number> = {};

  // --- orientation scoring ---
  if (questionId.includes('|orientation')) {
    const answer = response.trim().toLowerCase();
    const isMatch = answer.includes(gt.lineType.toLowerCase());
    scores.orientation = isMatch ? 1 : 0;
    return { score: scores.orientation, dimensionScores: scores };
  }

  // --- angle scoring ---
  if (questionId.includes('|angle')) {
    const numbers = extractNumbers(response);
    if (numbers.length === 0) {
      scores.angle = 0;
      return { score: 0, dimensionScores: scores };
    }
    // Take the first plausible number (0-360)
    const guess = numbers.find(n => n >= -360 && n <= 360) ?? numbers[0];
    // Normalize both angles to 0-180 range for comparison
    const expected = ((gt.angleDegrees % 180) + 180) % 180;
    const predicted = ((guess % 180) + 180) % 180;
    const diff = Math.abs(expected - predicted);
    const angularDiff = Math.min(diff, 180 - diff);
    // Score: 1.0 if within 5°, 0.5 if within 20°, linear between
    scores.angle = angularDiff <= 5 ? 1 : angularDiff <= 20 ? 1 - (angularDiff - 5) / 30 : Math.max(0, 1 - angularDiff / 90);
    return { score: scores.angle, dimensionScores: scores };
  }

  // --- open-ended description scoring ---
  const desc = response.toLowerCase();
  let hits = 0;
  let total = 3;

  // Check for orientation awareness
  if (gt.lineType === 'horizontal' && desc.includes('horizont')) hits++;
  else if (gt.lineType === 'vertical' && desc.includes('vertic')) hits++;
  else if (gt.lineType === 'diagonal' && desc.includes('diagon')) hits++;
  else if (desc.includes('line') || desc.includes('stroke')) hits++;

  // Check for color awareness
  if (desc.includes((gt.lineColor[0] > 128) ? 'white' : 'red') && gt.lineColor.includes(Math.max(...gt.lineColor))) {
    hits += 0.5;
  } else if (desc.includes('line') || desc.includes('draw')) {
    hits += 0.5; // partial credit for mentioning something
  }

  // General description quality (min length)
  const words = desc.split(/\s+/).length;
  if (words >= 10) hits += 0.5;
  else if (words >= 5) hits += 0.25;

  scores.description = Math.min(1, hits / total);
  return { score: scores.description, dimensionScores: scores };
}

/**
 * Score a dots response against ground truth.
 */
function scoreDots(
  response: string,
  questionId: string,
  gt: DotsGroundTruth
): { score: number; dimensionScores: Record<string, number> } {
  const scores: Record<string, number> = {};

  // --- counting scoring ---
  if (questionId.includes('|count')) {
    const numbers = extractNumbers(response);
    if (numbers.length === 0) {
      scores.count = 0;
      return { score: 0, dimensionScores: scores };
    }
    // Take the first number that could be a count
    const guess = numbers.find(n => n >= 0 && n <= 100) ?? numbers[0];
    const diff = Math.abs(guess - gt.dotCount);
    scores.count = diff === 0 ? 1 : diff === 1 ? 0.7 : diff <= 2 ? 0.4 : 0;
    return { score: scores.count, dimensionScores: scores };
  }

  // --- positions scoring ---
  if (questionId.includes('|positions')) {
    const desc = response.toLowerCase();
    const directionalWords = ['top', 'bottom', 'left', 'right', 'center', 'middle', 'corner', 'edge'];
    let mentioned = directionalWords.filter(w => desc.includes(w)).length;
    // Expected at least a few positional descriptors for the number of dots
    const expected = Math.max(2, Math.ceil(gt.dotCount * 0.6));
    scores.positions = Math.min(1, mentioned / Math.max(expected, 1));
    return { score: scores.positions, dimensionScores: scores };
  }

  // --- open-ended description scoring ---
  const desc = response.toLowerCase();
  let hits = 0;
  const total = 3;

  // Check if model mentions dots/circles/blobs
  if (desc.includes('dot') || desc.includes('circ') || desc.includes('point') || desc.includes('blob')) hits++;

  // Check count awareness (look for the number near words like "dot" or "circle")
  const numbers = extractNumbers(response);
  if (numbers.includes(gt.dotCount)) hits++;
  else if (numbers.some(n => Math.abs(n - gt.dotCount) <= 1)) hits += 0.5;

  // Check for positional awareness
  if (desc.includes('top') || desc.includes('bottom') || desc.includes('left') || desc.includes('right') || desc.includes('center')) hits++;

  scores.description = Math.min(1, hits / total);
  return { score: scores.description, dimensionScores: scores };
}

/**
 * Score a single model response against ground truth.
 */
export function scoreResponse(
  response: ModelResponse,
  groundTruth: GroundTruth
): EvalResult {
  let result: { score: number; dimensionScores: Record<string, number> };

  if (groundTruth.benchmark === 'angle') {
    result = scoreAngle(response.responseText, response.questionId, groundTruth);
  } else if (groundTruth.benchmark === 'dots') {
    result = scoreDots(response.responseText, response.questionId, groundTruth);
  } else {
    result = { score: 0, dimensionScores: {} };
  }

  return {
    sampleId: response.sampleId,
    questionId: response.questionId,
    modelId: response.modelId,
    provider: response.provider,
    groundTruthDescription: groundTruth.description,
    modelResponse: response.responseText,
    score: result.score,
    dimensionScores: result.dimensionScores,
    totalResponseTimeMs: response.totalResponseTimeMs,
    error: response.error,
  };
}
