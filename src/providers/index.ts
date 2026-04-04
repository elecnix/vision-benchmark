import type { Model, ModelResponse, ProviderConfig, ProviderName } from '../types.js';
import https from 'node:https';
import http from 'node:http';

function httpFetch(url: string, options: { method?: string; headers?: Record<string, string>; body?: string; timeout?: number }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const req = lib.request(url, {
      method: options.method ?? 'POST',
      headers: options.headers,
      timeout: options.timeout ?? 120_000,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request to ${url} timed out`));
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

/**
 * Call the OpenRouter API to get a vision model response.
 */
async function callOpenRouter(
  config: { apiKey: string; baseUrl?: string },
  model: Model,
  imageBase64: string,
  prompt: string
): Promise<string> {
  const baseUrl = config.baseUrl ?? 'https://openrouter.ai/api/v1';
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const payload = {
    model: model.id,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
          { type: 'text', text: prompt },
        ],
      },
    ],
    max_tokens: model.maxTokens ?? 1024,
    temperature: model.temperature ?? 0,
  };

  const res = await httpFetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/nicolas/vision-benchmark',
      'X-Title': 'vision-benchmark',
    },
    body: JSON.stringify(payload),
  });

  if (res.status !== 200) {
    throw new Error(`OpenRouter API error ${res.status}: ${res.body}`);
  }

  const data = JSON.parse(res.body);
  return data.choices?.[0]?.message?.content ?? '';
}

/**
 * Call the Ollama API to get a vision model response.
 */
async function callOllama(
  config: { baseUrl?: string; timeout?: number },
  model: Model,
  imageBase64: string,
  prompt: string
): Promise<string> {
  const baseUrl = config.baseUrl ?? 'http://localhost:11434';
  const url = `${baseUrl.replace(/\/+$/, '')}/api/chat`;

  const payload = {
    model: model.id,
    messages: [
      {
        role: 'user',
        content: prompt,
        images: [imageBase64],
      },
    ],
    stream: false,
    options: {
      temperature: model.temperature ?? 0,
      num_predict: model.maxTokens ?? 1024,
    },
  };

  const res = await httpFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    timeout: config.timeout ?? 120_000,
  });

  if (res.status !== 200) {
    throw new Error(`Ollama API error ${res.status}: ${res.body}`);
  }

  const data = JSON.parse(res.body);
  return data.message?.content ?? '';
}

/**
 * Run inference on a single sample with the given model and provider.
 */
export async function runInference(
  providerConfig: ProviderConfig,
  model: Model,
  imageBase64: string,
  prompt: string
): Promise<string> {
  switch (providerConfig.provider) {
    case 'openrouter':
      return callOpenRouter(providerConfig, model, imageBase64, prompt);
    case 'ollama':
      return callOllama(providerConfig, model, imageBase64, prompt);
    default:
      throw new Error(`Unknown provider: ${(providerConfig as any).provider}`);
  }
}

/**
 * List available models from the provider (best-effort).
 */
export async function listAvailableModels(providerConfig: ProviderConfig): Promise<string[]> {
  switch (providerConfig.provider) {
    case 'ollama': {
      const baseUrl = providerConfig.baseUrl ?? 'http://localhost:11434';
      const res = await httpFetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.status !== 200) return [];
      const data = JSON.parse(res.body);
      return (data.models ?? []).map((m: any) => m.name);
    }
    case 'openrouter':
      // OpenRouter has a large catalog; return common vision model IDs
      return [
        'google/gemini-2.0-flash-001',
        'google/gemini-2.0-pro-exp-02-05:free',
        'google/gemini-2.5-flash-preview-05-20',
        'google/gemini-2.5-pro',
        'meta-llama/llama-3.2-90b-vision-instruct',
        'meta-llama/llama-3.2-11b-vision-instruct:free',
        'mistralai/pixtral-large-2411',
        'qwen/qwen-2.5-vl-72b-instruct',
        'openbmb/minicpm-v-2_6:free',
      ];
    default:
      return [];
  }
}
