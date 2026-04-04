# vision-benchmark

**Deterministic synthetic benchmarks for vision-language models.**

Generate images with known ground truth from code. Evaluate any VLM on how well they actually *see* — not how well they've memorized training data.

## Why?

There are dozens of open-source vision-language models available through OpenRouter, Ollama, and other providers. But there's no standard way to know:
- Does this model actually *count* accurately, or does it guess?
- Can it distinguish a 45° diagonal from a vertical line?
- How does image resolution affect quality for a given model?

This benchmark generates **synthetic, deterministic images** at runtime. Every pixel is known. Every ground-truth answer is exact. No downloaded datasets, no stored images — just pure code-generated evaluation.

## Quick Start

```bash
# Install dependencies
pnpm install

# Run the angle benchmark against Gemini Flash via OpenRouter
export OPENROUTER_API_KEY="your-key-here"
pnpm bench:angle --model gemini-flash

# Run the angle benchmark against a local Ollama model
pnpm bench:angle --provider ollama --model llama3.2-vision

# Run the dots benchmark
pnpm bench:dots --model gemini-flash

# List available models
pnpm list:models --provider openrouter
pnpm list:models --provider ollama

# List available datasets
pnpm list:datasets
```

## Benchmarks

### `angle` — Line Angle & Orientation

Tests whether a model can correctly identify line orientation and measure angles.

| Feature | Values |
|---------|--------|
| Line types | horizontal, vertical, diagonal-45°, diagonal-135° |
| Sizes | 256×256, 512×512 |
| Line width | 8px (configurable) |
| Questions | Open description, exact angle, orientation classification |
| Scoring | Angle tolerance (±5° = full credit), orientation match, description quality |

```bash
pnpm bench:angle --model gemini-flash --model qwen-vl --model pixtral
```

### `dots` — Dot Counting & Positioning

Tests whether a model can count objects and describe spatial positions.

| Feature | Values |
|---------|--------|
| Dot counts | 1, 2, 3, 4, 5, 6, 9 |
| Sizes | 256×256, 512×512 |
| Layouts | scattered, grid |
| Questions | Open description, exact count, position description |
| Scoring | Exact/near count, positional word recall, description quality |

```bash
pnpm bench:dots --model gemini-flash
```

## How It Works

```
┌─────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│   Config        │     │  Image Generator  │     │  Ground Truth DB  │
│                 │────▶│  (node-canvas)    │────▶│  (in-memory)      │
│ sizes, colors,  │     │  deterministic    │     │  known angles,    │
│ dot counts...   │     │  pixel-perfect    │     │  exact positions  │
└─────────────────┘     └──────────────────┘     └───────────────────┘
                                                        │
                                                        ▼
┌─────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│   Results JSON  │◀────│   Evaluator       │◀────│  Model Responses   │
│   (saved to     │     │   scores [0-1]    │     │  (base64 image +   │
│   results/)     │     │   per dimension   │     │   prompt via API)  │
└─────────────────┘     └──────────────────┘     └───────────────────┘
```

1. **Generate** synthetic images using `node-canvas` — no files written to disk
2. **Query** models via OpenRouter or Ollama API with the base64 image + text prompt
3. **Score** responses against known ground truth
4. **Report** results as a summary table + detailed JSON

## Providers

### OpenRouter

Access cloud-hosted VLMs with a single API key.

```bash
export OPENROUTER_API_KEY="sk-or-..."
pnpm bench:angle --model gemini-flash
```

Available shorthand model names:
- `gemini-flash` → Google Gemini 2.0 Flash
- `gemini-pro` → Google Gemini 2.0 Pro
- `llama-3.2-11b` → Llama 3.2 11B Vision
- `llama-3.2-90b` → Llama 3.2 90B Vision
- `pixtral` → Mistral Pixtral Large
- `qwen-vl` → Qwen 2.5 VL 72B
- `minicpm` → MiniCPM-V 2.6

### Ollama

Run models locally with zero API costs.

```bash
# Make sure ollama is running and you've pulled a vision model
ollama pull llama3.2-vision

pnpm bench:angle --provider ollama --model llama3.2-vision
```

Both providers can be used simultaneously:

```bash
# Run the same benchmark against an OpenRouter model and a local model
pnpm bench:angle --provider ollama --model llama3.2-vision -m gemini-flash
```

## CLI Reference

```
Usage: vision-bench [options] [command]

Options:
  -V, --version          output the version number
  -h, --help             display help

Commands:
  bench angle [options]  Run the angle/line recognition benchmark
  bench dots [options]   Run the dot counting & positioning benchmark
  list models [options]  List available vision models
  list datasets          List available benchmark datasets
  show-config            Show default benchmark configurations
```

### Common Options

```
-p, --provider <name>        openrouter | ollama  (default: openrouter)
-k, --api-key <key>          API key for OpenRouter (or set OPENROUTER_API_KEY)
--ollama-url <url>           Ollama base URL (default: http://localhost:11434)
-m, --model <ids...>         Model ID(s) to test (shorthand or full)
--max-tokens <n>             Max output tokens (default: 1024)
--temperature <n>            Generation temperature (default: 0)
```

## Output

Results are saved to `results/` as timestamped JSON files:

```
results/
├── angle-1712000000000.json
└── dots-1712000060000.json
```

Each file contains per-sample scores, dimension breakdowns, response times, and a model-level summary table.

## Project Structure

```
src/
├── cli.ts                 # CLI entry point (commander)
├── config.ts              # Default configs & provider resolution
├── runner.ts              # Orchestrate: generate → query → score → summarize
├── types.ts               # TypeScript type definitions
├── generators/
│   └── index.ts           # Image generation (angle lines, dot patterns)
├── providers/
│   └── index.ts           # OpenRouter & Ollama API clients
└── benchmarks/
    ├── questions.ts        # Question generation per benchmark
    └── evaluator.ts        # Response scoring against ground truth
```

## Extending

Adding a new benchmark type takes three steps:

1. **Define ground truth types** in `src/types.ts`
2. **Write a generator** in `src/generators/index.ts` (yields `Sample` objects)
3. **Write question & scoring logic** in `src/benchmarks/questions.ts` and `src/benchmarks/evaluator.ts`

Then register it in `src/runner.ts` and `src/cli.ts`.

## License

MIT
