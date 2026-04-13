import type { Model, ProviderConfig } from '../types.js';

/**
 * Resolve the model ID for a given provider and model string.
 * Handles provider-specific formats.
 */
export function resolveModelId(model: string, provider: ProviderConfig): string {
  if (provider.provider === 'openrouter') {
    // OpenRouter uses author/model convention
    if (model.includes('/')) return model;
    const shortcuts: Record<string, string> = {
      'gemini-flash': 'google/gemini-2.0-flash-001',
      'gemini-pro': 'google/gemini-2.0-pro-exp-02-05:free',
      'llama-3.2-vision': 'meta-llama/llama-3.2-90b-vision-instruct',
      'llama-3.2-11b': 'meta-llama/llama-3.2-11b-vision-instruct:free',
      'llama-3.2-90b': 'meta-llama/llama-3.2-90b-vision-instruct',
      'pixtral': 'mistralai/pixtral-large-2411',
      'qwen-vl': 'qwen/qwen-2.5-vl-72b-instruct',
      'minicpm': 'openbmb/minicpm-v-2_6:free',
      'gemma-4-26b': 'google/gemma-4-26b-a4b-it:free',
      'gemma-4-31b': 'google/gemma-4-31b-it:free',
    };
    return shortcuts[model] ?? model;
  }
  return model;
}

/**
 * Build a Model object from shorthand args.
 */
export function makeModel(
  idOrShorthand: string,
  provider: ProviderConfig,
  options?: Partial<Model>
): Model {
  const resolvedId = resolveModelId(idOrShorthand, provider);
  return {
    id: resolvedId,
    provider: provider.provider,
    displayName: options?.displayName ?? idOrShorthand,
    maxTokens: options?.maxTokens ?? 1024,
    temperature: options?.temperature ?? 0,
    ...options,
  };
}
