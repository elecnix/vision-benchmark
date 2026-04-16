import type { EvalResult, ModelResponse, GroundTruth, AngleGroundTruth, DotsGroundTruth, OCRGroundTruth, UIGroundTruth } from '../types.js';

function extractNumbers(text: string): number[] {
  const m = text.match(/-?\d+\.?\d*/g);
  return m ? m.map(Number) : [];
}

function endOfQid(questionId: string): string {
  return questionId.split('|').pop() || '';
}

// ─── Angle scoring ──────────────────────────────────────────────────────────

function scoreAngle(response: string, questionId: string, gt: AngleGroundTruth): { score: number; dimensionScores: Record<string, number> } {
  const dims: Record<string, number> = {};
  const qType = endOfQid(questionId);
  if (qType === 'angle') {
    const nums = extractNumbers(response);
    if (!nums.length) return { score: 0, dimensionScores: { angle: 0 } };
    const guess = nums.find((n: number) => n >= 0 && n <= 180) ?? nums[0];
    const normExpected = Math.min(gt.angleDegrees % 180, 180 - (gt.angleDegrees % 180));
    const normGuess = Math.min(guess % 180, 180 - (guess % 180));
    const diff = Math.abs(normGuess - normExpected);
    dims.angle = diff <= 5 ? 1 : diff <= 15 ? 0.8 : diff <= 30 ? 0.5 : Math.max(0, 1 - diff / 90);
    return { score: dims.angle, dimensionScores: dims };
  }
  if (qType === 'length') {
    const lower = response.trim().toLowerCase();
    const expected = gt.barLength < 0.45 ? 'short' : gt.barLength > 0.75 ? 'long' : 'medium';
    dims.length = lower.includes(expected) ? 1 : 0;
    return { score: dims.length, dimensionScores: dims };
  }
  const lower = response.toLowerCase();
  let hits = 0;
  const lt = gt.lineType;
  if (lt === 'horizontal' && (lower.includes('horizont') || lower.includes('flat'))) hits++;
  else if (lt === 'vertical' && (lower.includes('vertic') || lower.includes('uprigh'))) hits++;
  else if (lt === 'diagonal' && (lower.includes('diagon') || lower.includes('slope'))) hits++;
  if (lower.split(/\s+/).length >= 8) hits++;
  if ((lt === 'horizontal' && lower.includes('horizontal')) || (lt === 'vertical' && lower.includes('vertical'))) hits += 0.5;
  dims.description = Math.min(1, hits / 2.5);
  return { score: dims.description, dimensionScores: dims };
}

// ─── Dots scoring ───────────────────────────────────────────────────────────

function scoreDots(response: string, questionId: string, gt: DotsGroundTruth): { score: number; dimensionScores: Record<string, number> } {
  const dims: Record<string, number> = {};
  const qType = endOfQid(questionId);
  if (qType === 'count') {
    const nums = extractNumbers(response);
    if (!nums.length) return { score: 0, dimensionScores: { count: 0 } };
    const guess = nums.find((n: number) => n > 0 && n <= 9999) ?? nums[0];
    const diff = Math.abs(guess - gt.dotCount);
    const pct = diff / Math.max(gt.dotCount, 1);
    dims.count = pct === 0 ? 1 : pct <= 0.05 ? 0.9 : pct <= 0.15 ? 0.7 : pct <= 0.3 ? 0.4 : 0;
    return { score: dims.count, dimensionScores: dims };
  }
  if (qType === 'colors') {
    const lower = response.toLowerCase();
    const colorKeywords = ['red', 'green', 'blue', 'orange', 'purple', 'yellow', 'cyan', 'pink', 'white', 'black', 'gray', 'grey'];
    const mentioned = colorKeywords.filter((c: string) => lower.includes(c));
    const uniqueColors = new Set(gt.dotPositions.map(p => {
      const r = p.color.toLowerCase();
      if (r.includes('255,0,0')) return 'red';
      if (r.includes('0,128,0')) return 'green';
      if (r.includes('0,0,255')) return 'blue';
      if (r.includes('255,165,0')) return 'orange';
      if (r.includes('128,0,128')) return 'purple';
      if (r.includes('255,255,0')) return 'yellow';
      if (r.includes('0,255,255')) return 'cyan';
      return r;
    }));
    const correct = mentioned.filter((c: string) => uniqueColors.has(c)).length;
    dims.colors = uniqueColors.size > 0 ? correct / uniqueColors.size : 0;
    return { score: dims.colors, dimensionScores: dims };
  }
  const lower = response.toLowerCase();
  let hits = 0;
  if (lower.includes('dot') || lower.includes('circ') || lower.includes('point') || lower.includes('sphere')) hits++;
  const nums = extractNumbers(response);
  if (nums.includes(gt.dotCount)) hits++;
  if (lower.includes('top') || lower.includes('bottom') || lower.includes('left') || lower.includes('right') || lower.includes('center')) hits++;
  dims.description = Math.min(1, hits / 3);
  return { score: dims.description, dimensionScores: dims };
}

// ─── OCR scoring ────────────────────────────────────────────────────────────

function scoreOCRRaw(response: string, gt: OCRGroundTruth): { score: number; dimensionScores: Record<string, number> } {
  const expected = gt.words.map(w => w.toLowerCase());
  const actual = response.toLowerCase().match(/[a-z0-9áéíóúàèìòùâêîôûäëïöü]+/g) || [];

  // Greedy in-order matching
  let matched = 0;
  let ai = 0;
  for (const ew of expected) {
    while (ai < actual.length && actual[ai] !== ew) ai++;
    if (ai < actual.length) { matched++; ai++; }
  }

  const accuracy = expected.length > 0 ? matched / expected.length : 0;
  const exactMatch = actual.length === expected.length && actual.every((w, i) => w === expected[i]);

  return {
    score: accuracy,
    dimensionScores: { ocr_accuracy: accuracy, ocr_exact: exactMatch ? 1 : 0 },
  };
}

// ─── UI Widget scoring ─────────────────────────────────────────────────────
// Question types: button-label, button-color, count-buttons, count-switches,
// switch-state, chip-label, badge-count, slider-value, progress-value,
// alert-type, alert-message, checkbox-state, section-count, title, density, color-scheme

function scoreUI(response: string, questionId: string, gt: UIGroundTruth): { score: number; dimensionScores: Record<string, number> } {
  const qType = endOfQid(questionId);
  const lower = response.toLowerCase().trim();
  const nums = extractNumbers(response);
  const dims: Record<string, number> = {};

  switch (qType) {
    case 'button-label': {
      const btn = gt.widgets.find(w => w.type === 'button');
      if (!btn) return { score: 0, dimensionScores: { button_label: 0 } };
      const expected = btn.label.toLowerCase();
      const match = lower === expected || lower.includes(expected);
      dims.button_label = match ? 1 : 0;
      return { score: dims.button_label, dimensionScores: dims };
    }
    case 'button-color': {
      const btn = gt.widgets.find(w => w.type === 'button' && w.variant === 'contained');
      if (!btn?.color) return { score: 0, dimensionScores: { button_color: 0 } };
      const expected = btn.color.toLowerCase();
      // Accept hex or color name
      const match = lower.includes(expected) || (expected.startsWith('#') && lower.includes(expected.replace('#', '')));
      dims.button_color = match ? 1 : 0;
      return { score: dims.button_color, dimensionScores: dims };
    }
    case 'count-buttons': {
      const expected = gt.widgets.filter(w => w.type === 'button').length;
      if (!nums.length) return { score: 0, dimensionScores: { count: 0 } };
      const guess = nums[0];
      const diff = Math.abs(guess - expected);
      dims.count = diff === 0 ? 1 : diff === 1 ? 0.5 : 0;
      return { score: dims.count, dimensionScores: dims };
    }
    case 'count-switches': {
      const expected = gt.widgets.filter(w => w.type === 'switch').length;
      if (!nums.length) return { score: 0, dimensionScores: { count: 0 } };
      const guess = nums[0];
      const diff = Math.abs(guess - expected);
      dims.count = diff === 0 ? 1 : diff === 1 ? 0.5 : 0;
      return { score: dims.count, dimensionScores: dims };
    }
    case 'switch-state': {
      const sw = gt.widgets.find(w => w.type === 'switch');
      if (!sw) return { score: 0, dimensionScores: { switch_state: 0 } };
      const expected = sw.checked ? 'on' : 'off';
      dims.switch_state = lower === expected || lower.includes(expected) ? 1 : 0;
      return { score: dims.switch_state, dimensionScores: dims };
    }
    case 'chip-label': {
      const chip = gt.widgets.find(w => w.type === 'chip');
      if (!chip) return { score: 0, dimensionScores: { chip_label: 0 } };
      const expected = chip.label.toLowerCase();
      dims.chip_label = lower === expected || lower.includes(expected) ? 1 : 0;
      return { score: dims.chip_label, dimensionScores: dims };
    }
    case 'badge-count': {
      const badge = gt.widgets.find(w => w.type === 'badge');
      if (!badge?.value) return { score: 0, dimensionScores: { badge_count: 0 } };
      const expected = badge.value;
      if (!nums.length) return { score: 0, dimensionScores: { badge_count: 0 } };
      dims.badge_count = nums.includes(expected) ? 1 : 0;
      return { score: dims.badge_count, dimensionScores: dims };
    }
    case 'slider-value': {
      const slider = gt.widgets.find(w => w.type === 'slider');
      if (!slider?.value) return { score: 0, dimensionScores: { slider_value: 0 } };
      const expected = slider.value;
      if (!nums.length) return { score: 0, dimensionScores: { slider_value: 0 } };
      const diff = Math.abs(nums[0] - expected);
      dims.slider_value = diff === 0 ? 1 : diff <= 5 ? 0.8 : diff <= 10 ? 0.5 : 0;
      return { score: dims.slider_value, dimensionScores: dims };
    }
    case 'progress-value': {
      const prog = gt.widgets.find(w => w.type === 'progress');
      if (!prog?.value) return { score: 0, dimensionScores: { progress_value: 0 } };
      const expected = prog.value;
      if (!nums.length) return { score: 0, dimensionScores: { progress_value: 0 } };
      const diff = Math.abs(nums[0] - expected);
      dims.progress_value = diff === 0 ? 1 : diff <= 5 ? 0.8 : diff <= 10 ? 0.5 : 0;
      return { score: dims.progress_value, dimensionScores: dims };
    }
    case 'alert-type': {
      const alert = gt.widgets.find(w => w.type === 'alert');
      if (!alert?.variant) return { score: 0, dimensionScores: { alert_type: 0 } };
      const expected = alert.variant;
      dims.alert_type = lower === expected || lower.includes(expected) ? 1 : 0;
      return { score: dims.alert_type, dimensionScores: dims };
    }
    case 'alert-message': {
      const alert = gt.widgets.find(w => w.type === 'alert');
      if (!alert?.label) return { score: 0, dimensionScores: { alert_message: 0 } };
      const expected = alert.label.toLowerCase();
      // Fuzzy: key words match
      const words = expected.split(/\s+/);
      const matched = words.filter(w => lower.includes(w)).length;
      dims.alert_message = matched / words.length;
      return { score: dims.alert_message, dimensionScores: dims };
    }
    case 'checkbox-state': {
      const cb = gt.widgets.find(w => w.type === 'checkbox');
      if (!cb) return { score: 0, dimensionScores: { checkbox_state: 0 } };
      const expected = cb.checked ? 'checked' : 'unchecked';
      dims.checkbox_state = lower === expected || lower.includes(expected) ? 1 : 0;
      return { score: dims.checkbox_state, dimensionScores: dims };
    }
    case 'section-count': {
      const expected = gt.sections.length;
      if (!nums.length) return { score: 0, dimensionScores: { section_count: 0 } };
      const diff = Math.abs(nums[0] - expected);
      dims.section_count = diff === 0 ? 1 : diff === 1 ? 0.5 : 0;
      return { score: dims.section_count, dimensionScores: dims };
    }
    case 'title': {
      const expected = gt.sections[0] || ''; // The title is the layout title, stored in sections for now
      const layoutTitle = (gt as any).layoutTitle || expected;
      dims.title = lower === layoutTitle.toLowerCase() || lower.includes(layoutTitle.toLowerCase()) ? 1 : 0;
      return { score: dims.title, dimensionScores: dims };
    }
    case 'density': {
      const expected = gt.density;
      dims.density = lower === expected || lower.includes(expected) ? 1 : 0;
      return { score: dims.density, dimensionScores: dims };
    }
    case 'color-scheme': {
      const expected = gt.palette.toLowerCase();
      // Check if response mentions the palette color
      const paletteColors: Record<string, string[]> = {
        blue: ['blue', '#1976d2', '1f79c0'],
        green: ['green', '#2e7d32'],
        red: ['red', '#d32f2f'],
        purple: ['purple', '#7b1fa2', 'violet'],
        teal: ['teal', '#00695c', 'cyan'],
        dark: ['dark', 'grey', 'gray', '#212121', 'night'],
        orange: ['orange', '#e65100'],
        pink: ['pink', '#c2185b', 'magenta'],
      };
      const validTerms = paletteColors[expected] || [expected];
      dims.color_scheme = validTerms.some(t => lower.includes(t)) ? 1 : 0;
      return { score: dims.color_scheme, dimensionScores: dims };
    }
    default:
      dims.unknown = 0;
      return { score: 0, dimensionScores: dims };
  }
}

// ─── Dispatch ───────────────────────────────────────────────────────────────

export function scoreResponse(response: ModelResponse, groundTruth: GroundTruth): EvalResult {
  let result: { score: number; dimensionScores: Record<string, number> };
  if (groundTruth.benchmark === 'angle') {
    result = scoreAngle(response.responseText, response.questionId, groundTruth as AngleGroundTruth);
  } else if (groundTruth.benchmark === 'dots') {
    result = scoreDots(response.responseText, response.questionId, groundTruth as DotsGroundTruth);
  } else if (groundTruth.benchmark === 'ui') {
    result = scoreUI(response.responseText, response.questionId, groundTruth as UIGroundTruth);
  } else {
    result = scoreOCRRaw(response.responseText, groundTruth as OCRGroundTruth);
  }
  const gtDesc = groundTruth.benchmark === 'ocr'
    ? `${groundTruth.description} — words: ${(groundTruth as OCRGroundTruth).words?.join(', ') ?? 'unknown'}`
    : groundTruth.benchmark === 'ui'
    ? `${(groundTruth as UIGroundTruth).layout} ${(groundTruth as UIGroundTruth).density} ${(groundTruth as UIGroundTruth).palette} — ${(groundTruth as UIGroundTruth).widgets.length} widgets in ${(groundTruth as UIGroundTruth).sections.length} sections`
    : groundTruth.description;
  return {
    sampleId: response.sampleId, questionId: response.questionId,
    modelId: response.modelId, provider: response.provider,
    groundTruthDescription: gtDesc,
    modelResponse: response.responseText, score: result.score,
    dimensionScores: result.dimensionScores,
    totalResponseTimeMs: response.totalResponseTimeMs, error: response.error,
  };
}
