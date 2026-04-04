import { generateOCRQuestions } from './ocr-questions.js';
import type { Sample, Question, AngleGroundTruth, DotsGroundTruth } from '../types.js';

/**
 * Generate questions for angle/line samples.
 *
 * Produces three questions per sample:
 *   1. Open-ended description
 *   2. Specific angle query
 *   3. Bar length estimate (short/medium/long)
 */
export function* generateAngleQuestions(samples: Sample[]): Generator<Question> {
  for (const sample of samples) {
    const gt = sample.groundTruth as AngleGroundTruth;

    yield {
      id: `${sample.id}|describe`,
      sampleId: sample.id,
      prompt: 'Describe what you see in this image. Focus on the orientation and angle of any lines or bars.',
    };

    yield {
      id: `${sample.id}|angle`,
      sampleId: sample.id,
      prompt: 'What is the angle of the bar/line in this image? Answer with just the number in degrees (0-180). 0 is horizontal, 90 is vertical.',
      answerTemplate: String(gt.angleDegrees),
    };

    yield {
      id: `${sample.id}|length`,
      sampleId: sample.id,
      prompt: 'Is the bar/line in this image short, medium, or long relative to the canvas? Answer with just one word.',
      answerTemplate: gt.barLength < 0.45 ? 'short' : gt.barLength > 0.75 ? 'long' : 'medium',
    };
  }
}

/**
 * Generate questions for colored dots samples.
 */
export function* generateColoredDotsQuestions(samples: Sample[]): Generator<Question> {
  for (const sample of samples) {
    const gt = sample.groundTruth as DotsGroundTruth;

    yield {
      id: `${sample.id}|describe`,
      sampleId: sample.id,
      prompt: 'Describe what you see in this image. Include the number of dots, their colors, and their approximate positions.',
    };

    yield {
      id: `${sample.id}|count`,
      sampleId: sample.id,
      prompt: `How many colored dots/circles do you see in this image? Answer with just the number.`,
      answerTemplate: String(gt.dotCount),
    };

    yield {
      id: `${sample.id}|colors`,
      sampleId: sample.id,
      prompt: `What ${gt.dotCount} color${gt.dotCount > 1 ? 's' : ''} do the dot${gt.dotCount > 1 ? 's have' : ' has'}? List the colors.`,
    };
  }
}

/**
 * Generate questions for dense black dots samples.
 */
export function* generateDenseDotsQuestions(samples: Sample[]): Generator<Question> {
  for (const sample of samples) {
    const gt = sample.groundTruth as DotsGroundTruth;

    yield {
      id: `${sample.id}|count`,
      sampleId: sample.id,
      prompt: `How many dots/circles do you see in this image? Answer with just the number.`,
      answerTemplate: String(gt.dotCount),
    };
  }
}

/**
 * Dispatch to the correct question generator based on ground truth type.
 */
export function* generateQuestions(samples: Sample[]): Generator<Question> {
  if (samples.length === 0) return;

  const benchmark = samples[0].groundTruth.benchmark;

  if (benchmark === 'ocr') {
    yield* generateOCRQuestions(samples);
    return;
  }

  if (benchmark === 'angle') {
    yield* generateAngleQuestions(samples);
    return;
  }

  // Both colored and dense dots use the same DotsGroundTruth type,
  // but we distinguish by sample count: dense dots have many more dots
  const isDense = samples.some(s => (s.groundTruth as DotsGroundTruth).dotCount > 8);

  if (isDense) {
    yield* generateDenseDotsQuestions(samples);
  } else {
    yield* generateColoredDotsQuestions(samples);
  }
}
