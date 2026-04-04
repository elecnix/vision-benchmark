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

export type GroundTruth = AngleGroundTruth | DotsGroundTruth;

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
