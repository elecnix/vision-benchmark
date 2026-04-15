#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Free models on OpenRouter with vision support
MODELS=(
  "google/gemma-3-27b-it:free"
  "google/gemma-3-12b-it:free"
  "google/gemma-3-4b-it:free"
  "nvidia/nemotron-nano-12b-v2-vl:free"
)

for MODEL in "${MODELS[@]}"; do
  SLUG=$(echo "$MODEL" | tr '/:@' '_')
  echo "============================================="
  echo "Running benchmarks for: $MODEL ($SLUG)"
  echo "============================================="
  
  echo "▶ Angle benchmark..."
  npx tsx src/cli.ts bench:angle -m "$MODEL" 2>&1 | tee "/tmp/bench-angle-${SLUG}.log"
  
  echo "▶ Colored-dots benchmark..."
  npx tsx src/cli.ts bench:colored-dots -m "$MODEL" 2>&1 | tee "/tmp/bench-cdots-${SLUG}.log"
  
  echo "▶ Dense-dots benchmark..."
  npx tsx src/cli.ts bench:dense-dots -m "$MODEL" 2>&1 | tee "/tmp/bench-ddots-${SLUG}.log"
  
  echo "▶ OCR benchmark..."
  npx tsx src/cli.ts bench:ocr -m "$MODEL" 2>&1 | tee "/tmp/bench-ocr-${SLUG}.log"
  
  echo "✅ Done with $MODEL"
  echo ""
done

echo "All benchmarks complete!"