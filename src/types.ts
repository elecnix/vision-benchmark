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

export interface AngleBenchmarkConfig {
  sizes?: ImageSize[];
  lines?: Array<'horizontal' | 'vertical' | 'diagonal-45' | 'diagonal-135' | string>;
  lineColors?: Array<[number, number, number]>;
  backgroundColors?: Array<[number, number, number]>;
  lineWidths?: number[];
}

export interface DotsBenchmarkConfig {
  sizes?: ImageSize[];
  dotCounts?: number[];
  dotRadii?: number[];
  dotColors?: Array<[number, number, number]>;
  backgroundColors?: Array<[number, number, number]>;
  layout?: 'scattered' | 'grid';
}

// ─── Ground Truth ───────────────────────────────────────────────────────────

export interface GroundTruthBase {
  name: string;
  width: number;
  height: number;
  format: 'png';
  description: string;
}

export interface AngleGroundTruth extends GroundTruthBase {
  benchmark: 'angle';
  lineType: 'horizontal' | 'vertical' | 'diagonal';
  angleDegrees: number;
  lineColor: [number, number, number];
  backgroundColor: [number, number, number];
  lineWidth: number;
}

export interface DotsGroundTruth extends GroundTruthBase {
  benchmark: 'dots';
  dotCount: number;
  dotPositions: Array<{ x: number; y: number }>;
  dotRadius: number;
  dotColor: [number, number, number];
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
  /** Base64 data URL to the original test image (embedded at generation time) */
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
