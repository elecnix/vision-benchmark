/**
 * bench:code-repro command
 * 
 * For each existing benchmark sample, asks the model:
 *   "Write code to reproduce this image using these drawing primitives"
 * Executes generated code in a sandbox, scores pixel-level precision/recall/F1.
 * Updates the report with side-by-side original vs reproduced views.
 */

import type { Model, ProviderConfig } from '../types.js';
import { samplesFor } from './runner.js';
import type { BenchmarkType, BenchConfig } from './runner.js';
import type { AnyBenchmarkConfig } from '../input-versioning.js';
import { runReproBenchmark, REPRO_PROMPT, comparePixels } from '../benchmarks/code-repro.js';
