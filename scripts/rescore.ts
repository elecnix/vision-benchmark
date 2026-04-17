#!/usr/bin/env node
/**
 * Re-score all result files using the updated evaluator.
 * This fixes:
 * - Angle "length" questions: borderline answers (30%→"medium", 60%→"long") get 0.5 instead of 0
 * - UI "title" questions: now correctly compares against the actual page title
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const RESULTS_DIR = join(process.cwd(), 'results');
const UI_TITLES: Record<string, string> = {
  "ui-000": "Calendar", "ui-001": "Metrics", "ui-002": "Metrics", "ui-003": "Orders",
  "ui-010": "Profile", "ui-011": "Inventory", "ui-012": "Revenue", "ui-013": "Sales",
  "ui-020": "Revenue", "ui-021": "Profile", "ui-022": "Inventory", "ui-023": "Tasks",
};

function endOfQid(qi: string) { return qi.split('|').pop() || ''; }

function extractNumbers(text: string): number[] {
  const m = text.match(/-?\d+\.?\d*/g);
  return m ? m.map(Number) : [];
}

function reScoreAngleLength(resp: string, sampleId: string): number | null {
  // Extract barLength from sampleId like "a-0000|angle-000-len30-256x256"
  const m = sampleId.match(/len(\d+)/);
  if (!m) return null;
  const barLen = parseInt(m[1]) / 100;
  const lower = resp.trim().toLowerCase();
  const expected = barLen < 0.45 ? 'short' : barLen > 0.75 ? 'long' : 'medium';
  if (lower.includes(expected)) return 1;
  if ((barLen < 0.45 && lower.includes('medium')) ||
      (barLen >= 0.45 && barLen <= 0.75 && (lower.includes('long') || lower.includes('short')))) {
    return 0.5;
  }
  return 0;
}

function reScoreUITitle(resp: string, sampleId: string): number | null {
  const sid = sampleId.split('|')[0];
  const title = UI_TITLES[sid];
  if (!title) return null;
  const lower = resp.toLowerCase().trim();
  return lower === title.toLowerCase() || lower.includes(title.toLowerCase()) ? 1 : 0;
}

let totalFixed = 0;
const files = readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json') && !f.startsWith('judge') && !f.startsWith('cache'));

for (const fname of files) {
  const fpath = join(RESULTS_DIR, fname);
  let changed = false;
  const d: any = JSON.parse(readFileSync(fpath, 'utf-8'));
  const results = d.results;
  if (!Array.isArray(results)) continue;

  for (const r of results) {
    const qType = endOfQid(r.questionId || '');
    let newScore: number | null = null;

    if (qType === 'length' && r.score === 0) {
      newScore = reScoreAngleLength(r.modelResponse || '', r.sampleId || '');
    } else if (qType === 'title' && r.score === 0) {
      newScore = reScoreUITitle(r.modelResponse || '', r.sampleId || '');
    }

    if (newScore !== null && newScore !== r.score) {
      console.log(`  ${fname}: ${r.questionId} ${r.score}→${newScore} "${(r.modelResponse || '').slice(0, 30)}"`);
      r.score = newScore;
      changed = true;
      totalFixed++;
    }
  }

  // Recompute modelScores averages
  if (changed) {
    const byModel: Record<string, number[]> = {};
    for (const r of results) {
      if (!byModel[r.modelId]) byModel[r.modelId] = [];
      byModel[r.modelId].push(r.score);
    }
    for (const [mid, scores] of Object.entries(byModel)) {
      if (d.modelScores && d.modelScores[mid]) {
        d.modelScores[mid].avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      }
    }
    writeFileSync(fpath, JSON.stringify(d, null, 2));
  }
}

console.log(`\nTotal scores fixed: ${totalFixed}`);