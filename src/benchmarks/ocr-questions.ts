import type { Sample, Question, OCRGroundTruth } from '../types.js';

/**
 * OCR questions are intentionally minimal — no hints.
 * The model is simply asked to transcribe what it sees.
 */
export function* generateOCRQuestions(samples: Sample[]): Generator<Question> {
  for (const sample of samples) {
    yield {
      id: `${sample.id}|transcribe`,
      sampleId: sample.id,
      prompt: 'Read every word in this image. Write them in order, separated by spaces.',
    };
  }
}
