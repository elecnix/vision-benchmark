import type { ProviderConfig, AngleBenchmarkConfig, DotsBenchmarkConfig } from './types.js';

/**
 * Default configurations for benchmarks.
 */

/**
 * Default angle benchmark config.
 */
export const defaultAngleConfig: AngleBenchmarkConfig = {
  sizes: [
    { width: 256, height: 256 },
    { width: 512, height: 512 },
  ],
  lines: ['horizontal', 'vertical', 'diagonal-45', 'diagonal-135'],
  lineColors: [[0, 0, 0]],
  backgroundColors: [[255, 255, 255]],
  lineWidths: [8],
};

/**
 * Default dots benchmark config.
 */
export const defaultDotsConfig: DotsBenchmarkConfig = {
  sizes: [
    { width: 256, height: 256 },
    { width: 512, height: 512 },
  ],
  dotCounts: [1, 2, 3, 4, 5, 6, 9],
  dotRadii: [16],
  dotColors: [[255, 0, 0]],
  backgroundColors: [[255, 255, 255]],
  layout: 'scattered',
};

/**
 * Resolve provider config from environment or CLI args.
 */
export function resolveProviderConfig(
  provider: string,
  opts?: { apiKey?: string; ollamaUrl?: string }
): ProviderConfig {
  switch (provider.toLowerCase()) {
    case 'openrouter': {
      const apiKey = opts?.apiKey ?? process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error(
          'OpenRouter API key required. Set OPENROUTER_API_KEY environment variable or pass --api-key.'
        );
      }
      return { provider: 'openrouter', apiKey };
    }
    case 'ollama': {
      return {
        provider: 'ollama',
        baseUrl: opts?.ollamaUrl ?? process.env.OLLAMA_BASE_URL,
      };
    }
    default:
      throw new Error(`Unknown provider: ${provider}. Supported: openrouter, ollama.`);
  }
}
