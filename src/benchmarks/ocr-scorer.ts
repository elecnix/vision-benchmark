import type { EvalResult, ModelResponse, OCRGroundTruth } from '../types.js';

/**
 * Score OCR output against ground-truth words.
 *
 * Strategy:
 * 1. Extract all "words" from the model response (any non-whitespace token)
 * 2. Check how many of the expected words appear in the response (in order, allowing gaps)
 * 3. Score = fraction of expected words found in correct relative order
 *
 * No hints — the model just gets the image and "Read every word..."
 */
export function scoreOCR(text: string, gt: OCRGroundTruth): { score: number; dimensionScores: Record<string, number> } {
  const expected = gt.words.map(w => w.toLowerCase());
  // Extract tokens from model response (lowercase, strip punctuation)
  const actual = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  
  // Greedy longest common subsequence (in-order matching)
  let matched = 0;
  let ai = 0;
  for (const ew of expected) {
    while (ai < actual.length && actual[ai] !== ew) ai++;
    if (ai < actual.length) {
      matched++;
      ai++;
    }
  }
  
  const accuracy = expected.length > 0 ? matched / expected.length : 0;
  
  // Also compute exact match (all words in exact order, no extras)
  const exactMatch = actual.length === expected.length && actual.every((w, i) => w === expected[i]);
  
  return {
    score: accuracy,
    dimensionScores: {
      ocr_accuracy: accuracy,
      ocr_exact: exactMatch ? 1 : 0,
    },
  };
}
