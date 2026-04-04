import type { Sample, Question, AngleGroundTruth, DotsGroundTruth } from '../types.js';

/**
 * Generate questions for angle/line samples.
 *
 * Produces two questions per sample:
 *   1. Open-ended description ("What do you see?")
 *   2. Specific angle query ("What is the angle of the line?")
 */
export function* generateAngleQuestions(samples: Sample[]): Generator<Question> {
  for (const sample of samples) {
    const gt = sample.groundTruth as AngleGroundTruth;

    // Open-ended description
    yield {
      id: `${sample.id}|describe`,
      sampleId: sample.id,
      prompt: 'Describe what you see in this image. Include details about lines, shapes, colors, orientation, and position.',
    };

    // Specific angle question
    yield {
      id: `${sample.id}|angle`,
      sampleId: sample.id,
      prompt: 'What is the angle of the line you see in this image? Answer with just the number in degrees (0-360), measured counter-clockwise from the horizontal axis pointing right.',
      answerTemplate: `${gt.angleDegrees}`,
    };

    // Follow-up: line type identification
    yield {
      id: `${sample.id}|orientation`,
      sampleId: sample.id,
      prompt: 'Is the line in this image horizontal, vertical, or diagonal? Answer with just one word.',
      answerTemplate: gt.lineType,
    };
  }
}

/**
 * Generate questions for dot samples.
 *
 * Produces two questions per sample:
 *   1. Open-ended description ("What do you see?")
 *   2. Specific counting query ("How many dots do you see?")
 */
export function* generateDotsQuestions(samples: Sample[]): Generator<Question> {
  for (const sample of samples) {
    const gt = sample.groundTruth as DotsGroundTruth;

    // Open-ended description
    yield {
      id: `${sample.id}|describe`,
      sampleId: sample.id,
      prompt: 'Describe what you see in this image. Include details about shapes, colors, count, positions, and layout.',
    };

    // Specific count question
    yield {
      id: `${sample.id}|count`,
      sampleId: sample.id,
      prompt: 'How many dots/circles do you see in this image? Answer with just the number.',
      answerTemplate: `${gt.dotCount}`,
    };

    // Follow-up: positions
    yield {
      id: `${sample.id}|positions`,
      sampleId: sample.id,
      prompt: `There are ${gt.dotCount} dots in this image. Describe their positions (e.g., top-left, center, bottom-right, etc.).`,
    };
  }
}

/**
 * Generate questions for samples based on their benchmark type.
 */
export function* generateQuestions(samples: Sample[]): Generator<Question> {
  if (samples.length === 0) return;

  const benchmark = samples[0].groundTruth.benchmark;
  switch (benchmark) {
    case 'angle':
      yield* generateAngleQuestions(samples);
      break;
    case 'dots':
      yield* generateDotsQuestions(samples);
      break;
    default:
      throw new Error(`Unknown benchmark type: ${benchmark}`);
  }
}
