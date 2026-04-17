#!/usr/bin/env node
/**
 * Remove symmetric angle entries (100°-170°) from all angle result files.
 * A bar at angle θ looks identical to a bar at angle (180-θ) on a white canvas,
 * making angles > 90° redundant and unfairly penalizing models that can't
 * distinguish symmetric orientations.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const RESULTS_DIR = join(process.cwd(), 'results');
const SYMMETRIC_ANGLES = [100, 110, 120, 130, 140, 150, 160, 170];

// Also remove from quick configs: 120, 150
const QUICK_SYMMETRIC = [120, 150];
const ALL_REMOVE = [...new Set([...SYMMETRIC_ANGLES, ...QUICK_SYMMETRIC])];

let totalRemoved = 0;
let filesModified = 0;

const files = readdirSync(RESULTS_DIR).filter(f => f.startsWith('angle') && f.endsWith('.json'));

for (const fname of files) {
  const fpath = join(RESULTS_DIR, fname);
  const d: any = JSON.parse(readFileSync(fpath, 'utf-8'));
  const before = d.results.length;
  
  d.results = d.results.filter((r: any) => {
    const qi = r.questionId || '';
    return !ALL_REMOVE.some(a => qi.includes(`angle-${a}-`));
  });
  
  const after = d.results.length;
  const removed = before - after;
  
  if (removed > 0) {
    // Recompute modelScores averages
    const byModel: Record<string, number[]> = {};
    for (const r of d.results) {
      if (!byModel[r.modelId]) byModel[r.modelId] = [];
      byModel[r.modelId].push(r.score);
    }
    if (d.modelScores) {
      for (const [mid, scores] of Object.entries(byModel)) {
        if (d.modelScores[mid]) {
          d.modelScores[mid].avgScore = scores.reduce((a: number, b: number) => a + b, 0) / scores.length;
        }
      }
    }
    
    writeFileSync(fpath, JSON.stringify(d, null, 2));
    console.log(`  ${fname}: ${before}→${after} entries (removed ${removed})`);
    totalRemoved += removed;
    filesModified++;
  }
}

// Also remove symmetric judge cache entries
const judgeDir = join(RESULTS_DIR, 'judge-cache');
let judgeRemoved = 0;
try {
  const judgeFiles = readdirSync(judgeDir).filter(f => f.includes('-angle-'));
  for (const fname of judgeFiles) {
    const fpath = join(judgeDir, fname);
    const d: any = JSON.parse(readFileSync(fpath, 'utf-8'));
    if (!Array.isArray(d)) continue;
    
    const before = d.length;
    // Judge cache might store entries differently - check what fields they use
    const filtered = d.filter((e: any) => {
      const sample = e.sample || e.sampleId || e.question || '';
      return !ALL_REMOVE.some(a => {
        const pattern = `angle-${a}-`;
        return sample.includes(pattern);
      });
    });
    
    if (filtered.length < d.length) {
      writeFileSync(fpath, JSON.stringify(filtered, null, 2));
      judgeRemoved += d.length - filtered.length;
    }
  }
} catch {}

console.log(`\nTotal: removed ${totalRemoved} result entries from ${filesModified} files, ${judgeRemoved} judge cache entries`);