/**
 * Core type definitions for the vision-benchmark system.
 */

// ─── Providers ──────────────────────────────────────────────────────────────

export type ProviderName = 'openrouter' | 'ollama';

export interface OpenRouterConfig {
  provider: 'openrouter';
  apiKey: string;
  baseUrl?: string;
}

export interface OllamaConfig {
  provider: 'ollama';
  baseUrl?: string;
  timeout?: number;
}

export type ProviderConfig = OpenRouterConfig | OllamaConfig;

// ─── Models ─────────────────────────────────────────────────────────────────

export interface Model {
  id: string;
  provider: ProviderName;
  displayName?: string;
  maxTokens?: number;
  temperature?: number;
}

// ─── Image Generation Config ────────────────────────────────────────────────

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * Angle benchmark config — lines at various angles and lengths on solid backgrounds.
 */
export interface AngleBenchmarkConfig {
  sizes?: ImageSize[];
  /** Angles in degrees (0 = right/east, CCW). Defaults to every 10°: 0..350 */
  angleSteps?: number[];
  /** Bar lengths as fraction of the image diagonal. 1.0 = edge-to-edge. */
  barLengths?: number[];
  barColors?: Array<[number, number, number]>;
  backgroundColors?: Array<[number, number, number]>;
  lineWidths?: number[];
}

/**
 * Colored dots benchmark — multicolored dots at known positions.
 */
export interface ColoredDotsBenchmarkConfig {
  sizes?: ImageSize[];
  dotCounts?: number[];
  dotRadii?: number[];
  /** Each sample uses these colors randomly placed */
  dotColors?: Array<[number, number, number]>;
  backgroundColors?: Array<[number, number, number]>;
  layout?: 'scattered' | 'grid';
}

/**
 * Dense black dots benchmark — many small black dots on white background.
 */
export interface DenseDotsBenchmarkConfig {
  sizes?: ImageSize[];
  dotCounts?: number[];
  dotRadius?: number;
  dotColor?: [number, number, number];
  /** Controls how spread out the dots are (0.05-0.30, default 0.15) */
  margin?: number;
}

export interface OCRBenchmarkConfig {
  sizes?: ImageSize[];
  /** Which OCR test cases to run */
  cases?: OCRCase[];
  /** Font color [r,g,b], default black */
  fontColor?: [number, number, number];
  /** Background color [r,g,b], default white */
  backgroundColor?: [number, number, number];
  /** Seed for deterministic word generation, default 42 */
  seed?: number;
}

export type OCRCaseType =
  | 'single-small'     // 1 word, tiny, centered
  | 'single-large'     // 1 word, huge, centered
  | 'multi-2'          // 2 words, semi-random
  | 'multi-3'          // 3 words, semi-random
  | 'multi-4'          // 4 words, semi-random
  | 'multi-5'          // 5 words, semi-random
  | 'paragraph-col-left'   // ~15 words, vertical column hugging left edge
  | 'paragraph-col-center' // ~15 words, vertical column hugging middle
  | 'paragraph-col-right'  // ~15 words, vertical column hugging right edge
  | 'paragraph-row-top'    // ~15 words, horizontal row hugging top edge
  | 'paragraph-row-center' // ~15 words, horizontal row hugging middle
  | 'paragraph-row-bottom';// ~15 words, horizontal row hugging bottom edge

export interface OCRCase {
  type: OCRCaseType;
  /** For 'multi-*' cases (2-5), for paragraph cases this is the word count */
  wordCount?: number;
}

// ─── Ground Truth ───────────────────────────────────────────────────────────

export interface GroundTruthBase {
  /** Human-readable identifier */
  sampleId: string;
  width: number;
  height: number;
  format: 'png';
  description: string;
}

export interface AngleGroundTruth extends GroundTruthBase {
  benchmark: 'angle';
  /** Angle in degrees from +X axis, counter-clockwise */
  angleDegrees: number;
  /** Bar length as fraction of image diagonal */
  barLength: number;
  lineType: 'horizontal' | 'vertical' | 'diagonal';
  barColor: [number, number, number];
  backgroundColor: [number, number, number];
  lineWidth: number;
}

export interface DotsGroundTruth extends GroundTruthBase {
  benchmark: 'dots';
  dotCount: number;
  dotPositions: Array<{ x: number; y: number; color: string }>;
  dotRadius: number;
  backgroundColor: [number, number, number];
}

export interface OCRGroundTruth extends GroundTruthBase {
  benchmark: 'ocr';
  words: string[]; // The exact words the model must find in order
  fontSize: number;
  fontFamily: string;
  fontStyle: OCRCaseType;
}

export type GroundTruth = AngleGroundTruth | DotsGroundTruth | OCRGroundTruth;

// ─── Samples ────────────────────────────────────────────────────────────────

export interface Sample {
  id: string;
  imageBase64: string;
  groundTruth: GroundTruth;
}

// ─── Questions ──────────────────────────────────────────────────────────────

export interface Question {
  id: string;
  sampleId: string;
  prompt: string;
  answerTemplate?: string;
}

// ─── Model Responses ────────────────────────────────────────────────────────

export interface ModelResponse {
  sampleId: string;
  questionId: string;
  modelId: string;
  provider: ProviderName;
  responseText: string;
  timeToFirstTokenMs?: number;
  totalResponseTimeMs: number;
  outputTokens?: number;
  error?: string;
}

// ─── Evaluation ─────────────────────────────────────────────────────────────

export interface EvalResult {
  sampleId: string;
  questionId: string;
  modelId: string;
  provider: ProviderName;
  groundTruthDescription: string;
  imageDataUrl?: string;
  modelResponse: string;
  score: number;
  dimensionScores?: Record<string, number>;
  totalResponseTimeMs: number;
  error?: string;
}

export interface BenchmarkSummary {
  benchmark: string;
  startedAt: string;
  endedAt: string;
  modelCount: number;
  sampleCount: number;
  results: EvalResult[];
  modelScores: Record<string, { avgScore: number; avgTimeMs: number; sampleCount: number }>;
}
