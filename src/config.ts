import type { ProviderConfig, AngleBenchmarkConfig, ColoredDotsBenchmarkConfig, DenseDotsBenchmarkConfig, OCRBenchmarkConfig, UIBenchmarkConfig } from './types.js';

export const defaultAngleConfig: AngleBenchmarkConfig = {
  sizes: [{ width: 256, height: 256 }],
  angleSteps: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90],
  barLengths: [0.3, 0.6, 0.95],
  barColors: [[0, 0, 0]],
  backgroundColors: [[255, 255, 255]],
  lineWidths: [6],
};

export const quickAngleConfig: AngleBenchmarkConfig = {
  sizes: [{ width: 256, height: 256 }],
  angleSteps: [0, 30, 60, 90],
  barLengths: [0.3, 0.95],
  barColors: [[0, 0, 0]],
  backgroundColors: [[255, 255, 255]],
  lineWidths: [6],
};

export const defaultColoredDotsConfig: ColoredDotsBenchmarkConfig = {
  sizes: [{ width: 512, height: 512 }],
  dotCounts: [1, 2, 3, 4, 5, 6],
  dotRadii: [14],
  backgroundColors: [[255, 255, 255]],
  layout: 'scattered',
};

export const defaultDenseDotsConfig: DenseDotsBenchmarkConfig = {
  sizes: [{ width: 512, height: 512 }],
  dotCounts: [10, 20, 40, 80, 120, 200],
  dotRadius: 4,
  dotColor: [0, 0, 0],
};

export const quickDenseDotsConfig: DenseDotsBenchmarkConfig = {
  sizes: [{ width: 512, height: 512 }],
  dotCounts: [10, 20, 40, 80],
  dotRadius: 4,
  dotColor: [0, 0, 0],
};

export const expandedAngleConfig: AngleBenchmarkConfig = {
  sizes: [{ width: 256, height: 256 }, { width: 512, height: 512 }],
  angleSteps: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90],
  barLengths: [0.3, 0.6, 0.95],
  barColors: [[0, 0, 0]],
  backgroundColors: [[255, 255, 255]],
  lineWidths: [6],
};

export const expandedDenseDotsConfig: DenseDotsBenchmarkConfig = {
  sizes: [{ width: 512, height: 512 }, { width: 256, height: 256 }],
  dotCounts: [10, 20, 40, 80, 120, 200, 300],
  dotRadius: 4,
  dotColor: [0, 0, 0],
};

export const expandedColoredDotsConfig: ColoredDotsBenchmarkConfig = {
  sizes: [{ width: 512, height: 512 }, { width: 256, height: 256 }],
  dotCounts: [1, 2, 3, 4, 5, 6, 7, 8],
  dotRadii: [14],
  backgroundColors: [[255, 255, 255]],
  layout: 'scattered',
};

export const defaultOCRConfig: OCRBenchmarkConfig = {
  sizes: [{ width: 512, height: 512 }],
};

export const expandedOCRConfig: OCRBenchmarkConfig = {
  sizes: [{ width: 512, height: 512 }, { width: 256, height: 256 }, { width: 768, height: 768 }],
};

export const defaultUIConfig: UIBenchmarkConfig = {
  sizes: [{ width: 512, height: 512 }],
  densities: ['sparse', 'normal', 'dense'],
  variationsPerDensity: 4,
  seed: 42,
};

export function resolveProviderConfig(
  provider: string,
  opts?: { apiKey?: string; ollamaUrl?: string }
): ProviderConfig {
  switch (provider.toLowerCase()) {
    case 'openrouter': {
      const apiKey = opts?.apiKey ?? process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error('Set OPENROUTER_API_KEY or pass --api-key');
      return { provider: 'openrouter', apiKey };
    }
    case 'ollama':
      return { provider: 'ollama', baseUrl: opts?.ollamaUrl ?? process.env.OLLAMA_BASE_URL };
    default:
      throw new Error(`Unknown provider: ${provider}. Supported: openrouter, ollama.`);
  }
}