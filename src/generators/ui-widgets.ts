import type { Sample, Question, UIGroundTruth, UIBenchmarkConfig } from '../types.js';

// ─── Deterministic PRNG (mulberry32) ────────────────────────────────────────
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ─── Color palettes ────────────────────────────────────────────────────────
const PALETTES = [
  { name: 'blue', primary: '#1976d2', secondary: '#9c27b0', bg: '#f5f5f5' },
  { name: 'green', primary: '#2e7d32', secondary: '#ed6c02', bg: '#f1f8e9' },
  { name: 'red', primary: '#d32f2f', secondary: '#0288d1', bg: '#fbe9e7' },
  { name: 'purple', primary: '#7b1fa2', secondary: '#f57c00', bg: '#f3e5f5' },
  { name: 'teal', primary: '#00695c', secondary: '#c62828', bg: '#e0f2f1' },
  { name: 'dark', primary: '#90caf9', secondary: '#ce93d8', bg: '#212121' },
  { name: 'orange', primary: '#e65100', secondary: '#1565c0', bg: '#fff3e0' },
  { name: 'pink', primary: '#c2185b', secondary: '#00838f', bg: '#fce4ec' },
];

// ─── Widget types ──────────────────────────────────────────────────────────
type WidgetDef = {
  type: string;
  label: string;
  color?: string;
  bgColor?: string;
  variant?: string;
  text?: string;
  value?: number;
  checked?: boolean;
  items?: string[];
  placeholder?: string;
  rows?: number;
  icon?: string;
  size?: 'small' | 'medium' | 'large';
  margin?: string;
  padding?: string;
  fontSize?: number;
  fontWeight?: string;
  borderRadius?: string;
  width?: string;
  elevation?: number;
};

// ─── Word pools for realistic content ───────────────────────────────────────
const NAMES = ['Dashboard', 'Analytics', 'Settings', 'Profile', 'Reports', 'Sales', 'Revenue', 'Users', 'Orders', 'Inventory', 'Projects', 'Tasks', 'Metrics', 'Overview', 'Calendar', 'Messages', 'Notifications', 'Accounts', 'Database', 'Pipeline'];
const LABELS = ['Submit', 'Cancel', 'Save', 'Delete', 'Edit', 'Create', 'Update', 'Close', 'Confirm', 'Reset', 'Download', 'Upload', 'Search', 'Filter', 'Export', 'Import', 'Send', 'Approve', 'Reject', 'Enable'];
const STATUS_ITEMS = ['Active', 'Pending', 'Complete', 'Failed', 'Running', 'Paused', 'Archived', 'Draft', 'Review', 'Approved'];
const CATEGORIES = ['Engineering', 'Marketing', 'Sales', 'Design', 'Finance', 'Operations', 'Support', 'Legal', 'HR', 'Product'];
const METRIC_NAMES = ['Conversion Rate', 'Revenue', 'Users', 'Sessions', 'Bounce Rate', 'Avg Duration', 'Page Views', 'Sign-ups', 'Retention', 'Churn'];

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}
function pickN<T>(arr: T[], n: number, rng: () => number): T[] {
  const copy = [...arr];
  const result: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(rng() * copy.length);
    result.push(copy.splice(idx, 1)[0]);
  }
  return result;
}
function randInt(min: number, max: number, rng: () => number) {
  return Math.floor(rng() * (max - min + 1)) + min;
}
function randFloat(min: number, max: number, rng: () => number) {
  return min + rng() * (max - min);
}

// ─── Layout types ──────────────────────────────────────────────────────────
type LayoutType = 'dashboard' | 'form' | 'list' | 'card-grid' | 'sidebar' | 'stacked' | 'split';

// ─── Generate a single widget definition ───────────────────────────────────
function generateWidget(rng: () => number, palette: typeof PALETTES[0], density: 'sparse' | 'normal' | 'dense'): WidgetDef {
  const widgetTypes = ['button', 'switch', 'chip', 'textfield', 'slider', 'avatar', 'badge', 'progress', 'alert', 'typography', 'checkbox', 'radio', 'iconbutton', 'card', 'table-row'];
  const type = pick(widgetTypes, rng);
  const sizeOptions: ('small' | 'medium' | 'large')[] = ['small', 'medium', 'large'];
  const size = density === 'dense' ? 'small' : pick(sizeOptions, rng);

  const base: WidgetDef = { type, label: pick(LABELS, rng), size };

  switch (type) {
    case 'button':
      base.variant = pick(['contained', 'outlined', 'text'], rng);
      base.color = pick([palette.primary, palette.secondary, '#4caf50', '#f44336', '#ff9800'], rng);
      base.label = pick(LABELS, rng);
      base.icon = rng() > 0.5 ? pick(['save', 'delete', 'search', 'add', 'close', 'edit', 'download'], rng) : undefined;
      break;
    case 'switch':
      base.checked = rng() > 0.5;
      base.label = pick(['Dark Mode', 'Notifications', 'Auto-save', 'Sync', 'WiFi', 'GPS', 'Debug', 'Logging'], rng);
      base.color = palette.primary;
      break;
    case 'chip':
      base.label = pick([...STATUS_ITEMS, ...CATEGORIES], rng);
      base.variant = pick(['filled', 'outlined'], rng);
      base.color = pick([palette.primary, palette.secondary, '#4caf50', '#f44336', '#ff9800', '#9e9e9e'], rng);
      break;
    case 'textfield':
      base.label = pick(['Name', 'Email', 'Password', 'Search', 'Address', 'Phone', 'City', 'Company', 'Title', 'Description'], rng);
      base.placeholder = `Enter ${base.label.toLowerCase()}`;
      base.variant = pick(['outlined', 'filled', 'standard'], rng);
      base.rows = rng() > 0.7 ? 3 : 1;
      break;
    case 'slider':
      base.label = pick(['Volume', 'Brightness', 'Zoom', 'Opacity', 'Threshold', 'Limit', 'Range'], rng);
      base.value = randInt(10, 90, rng);
      break;
    case 'avatar':
      base.label = pick(['JD', 'AB', 'KL', 'MN', 'RS', 'TW', 'PQ', 'EF'], rng);
      base.bgColor = pick([palette.primary, palette.secondary, '#4caf50', '#ff9800', '#9c27b0'], rng);
      break;
    case 'badge':
      base.label = pick(['Inbox', 'Cart', 'Alerts', 'Messages', 'Updates'], rng);
      base.value = randInt(1, 99, rng);
      base.color = pick([palette.primary, '#f44336', '#ff9800'], rng);
      break;
    case 'progress':
      base.label = pick(['Loading', 'Upload', 'Download', 'Sync', 'Deploy', 'Build'], rng);
      base.value = randInt(10, 95, rng);
      base.color = pick([palette.primary, palette.secondary, '#4caf50', '#f44336'], rng);
      break;
    case 'alert':
      base.label = pick(['Operation successful', 'Warning: Low disk space', 'Error: Connection lost', 'Info: New version available', 'Tip: Use keyboard shortcuts', 'Heads up: Maintenance scheduled'], rng);
      base.variant = pick(['success', 'warning', 'error', 'info'], rng);
      break;
    case 'typography':
      base.label = pick(NAMES, rng);
      base.fontSize = pick([12, 14, 16, 20, 24, 28, 32], rng);
      base.fontWeight = pick(['normal', 'bold', '500', '600'], rng);
      break;
    case 'checkbox':
      base.checked = rng() > 0.5;
      base.label = pick(['Terms of service', 'Remember me', 'Subscribe', 'Public profile', 'Email updates', 'Marketing emails'], rng);
      base.color = palette.primary;
      break;
    case 'radio':
      base.checked = rng() > 0.5;
      base.label = pick(['Option A', 'Option B', 'Option C', 'None', 'Custom', 'Default'], rng);
      break;
    case 'iconbutton':
      base.icon = pick(['search', 'add', 'delete', 'edit', 'close', 'favorite', 'settings', 'share', 'download', 'upload'], rng);
      base.color = pick([palette.primary, palette.secondary, '#757575'], rng);
      break;
    case 'card':
      base.label = pick(NAMES, rng);
      base.elevation = randInt(0, 4, rng);
      base.bgColor = rng() > 0.5 ? '#ffffff' : palette.bg;
      break;
    case 'table-row':
      base.items = pickN(STATUS_ITEMS, randInt(2, 5, rng), rng);
      base.label = pick(NAMES, rng);
      break;
  }

  // Add margin/padding override for density
  if (density === 'dense') {
    base.margin = pick(['2px', '4px', '6px'], rng);
    base.padding = pick(['4px', '6px', '8px'], rng);
  } else {
    base.margin = pick(['4px', '8px', '12px', '16px'], rng);
    base.padding = pick(['8px', '12px', '16px'], rng);
  }

  return base;
}

// ─── Generate a layout (list of widget groups) ─────────────────────────────
type LayoutDef = {
  type: LayoutType;
  title: string;
  palette: typeof PALETTES[0];
  density: 'sparse' | 'normal' | 'dense';
  widgets: WidgetDef[];
  sections: { title: string; widgets: WidgetDef[] }[];
};

function generateLayout(rng: () => number): LayoutDef {
  const palette = pick(PALETTES, rng);
  const density: LayoutDef['density'] = pick(['sparse', 'normal', 'dense'], rng);
  const layoutType: LayoutType = pick(['dashboard', 'form', 'list', 'card-grid', 'sidebar', 'stacked', 'split'], rng);
  
  const numSections = density === 'dense' ? randInt(3, 6, rng) : randInt(2, 4, rng);
  const numWidgetsPerSection = density === 'dense' ? randInt(4, 8, rng) : density === 'sparse' ? randInt(1, 3, rng) : randInt(2, 5, rng);
  
  const sections: LayoutDef['sections'] = [];
  const allWidgets: WidgetDef[] = [];
  
  for (let i = 0; i < numSections; i++) {
    const sectionWidgets: WidgetDef[] = [];
    for (let j = 0; j < numWidgetsPerSection; j++) {
      const w = generateWidget(rng, palette, density);
      sectionWidgets.push(w);
      allWidgets.push(w);
    }
    sections.push({ title: pick(NAMES, rng), widgets: sectionWidgets });
  }
  
  return {
    type: layoutType,
    title: pick(NAMES, rng),
    palette,
    density,
    widgets: allWidgets,
    sections,
  };
}

// ─── Render widget to React element (HTML string via SSR) ──────────────────
function renderWidgetHtml(w: WidgetDef, palette: typeof PALETTES[0]): string {
  const m = w.margin || '8px';
  const p = w.padding || '12px';
  const style = `margin:${m};padding:${p};`;
  
  switch (w.type) {
    case 'button': {
      const bg = w.variant === 'contained' ? `background:${w.color};color:#fff;` : w.variant === 'outlined' ? `border:2px solid ${w.color};color:${w.color};` : `color:${w.color};`;
      const iconHtml = w.icon ? `<span style="font-size:${w.size === 'small' ? '14' : '18'}px;margin-right:4px;">{{${w.icon}}}</span>` : '';
      return `<button style="${style}${bg}border-radius:4px;cursor:pointer;font-size:${w.size === 'small' ? '12' : w.size === 'large' ? '16' : '14'}px;padding:${w.size === 'small' ? '4px 10px' : w.size === 'large' ? '8px 22px' : '6px 16px'};font-weight:500;letter-spacing:0.5px;text-transform:uppercase;border:${w.variant === 'outlined' ? '' : 'none'}">${iconHtml}${w.label}</button>`;
    }
    case 'switch': {
      const trackColor = w.checked ? w.color : '#ccc';
      return `<div style="${style}display:flex;align-items:center;gap:8px;"><div style="width:36px;height:20px;border-radius:10px;background:${trackColor};position:relative;"><div style="width:16px;height:16px;border-radius:50%;background:#fff;position:absolute;top:2px;${w.checked ? 'right:2px' : 'left:2px'};box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div></div><span style="font-size:14px">${w.label}</span></div>`;
    }
    case 'chip': {
      const bg = w.variant === 'filled' ? `background:${w.color};color:#fff;` : `border:1px solid ${w.color};color:${w.color};`;
      return `<span style="${style}${bg}border-radius:16px;padding:${w.size === 'small' ? '2px 8px' : '4px 12px'};font-size:${w.size === 'small' ? '11' : '13'}px;font-weight:500;display:inline-block">${w.label}</span>`;
    }
    case 'textfield': {
      const variant = w.variant || 'outlined';
      const borderStyle = variant === 'outlined' ? `border:1px solid #999;border-radius:4px;` : variant === 'filled' ? `border:none;border-radius:4px 4px 0 0;background:#eee;` : `border:none;border-bottom:1px solid #999;`;
      return `<div style="${style}"><label style="font-size:12px;color:#666;margin-bottom:2px;display:block">${w.label}</label><input placeholder="${w.placeholder || ''}" style="${borderStyle}padding:8px 12px;width:100%;font-size:14px;outline:none;${w.rows && w.rows > 1 ? 'height:' + (w.rows * 24) + 'px' : ''}"></div>`;
    }
    case 'slider': {
      const pct = (w.value || 50) + '%';
      return `<div style="${style}"><div style="font-size:13px;margin-bottom:4px">${w.label}: ${w.value}%</div><div style="width:100%;height:4px;background:#ddd;border-radius:2px;position:relative"><div style="width:${pct};height:100%;background:${palette.primary};border-radius:2px"></div><div style="width:12px;height:12px;border-radius:50%;background:${palette.primary};position:absolute;top:-4px;left:${pct};box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div></div></div>`;
    }
    case 'avatar': {
      return `<div style="${style}width:${w.size === 'small' ? 32 : w.size === 'large' ? 56 : 40}px;height:${w.size === 'small' ? 32 : w.size === 'large' ? 56 : 40}px;border-radius:50%;background:${w.bgColor || palette.primary};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:${w.size === 'small' ? 12 : w.size === 'large' ? 20 : 14}px">${w.label}</div>`;
    }
    case 'badge': {
      const n = w.value || 1;
      return `<div style="${style}position:relative;display:inline-block"><span style="font-size:14px">${w.label}</span><span style="position:absolute;top:-8px;right:-16px;background:${w.color || '#f44336'};color:#fff;border-radius:10px;padding:1px 5px;font-size:11px;font-weight:600;min-width:16px;text-align:center">${n}</span></div>`;
    }
    case 'progress': {
      const pct = (w.value || 50) + '%';
      const color = w.color || palette.primary;
      return `<div style="${style}"><div style="font-size:13px;margin-bottom:4px">${w.label} ${w.value}%</div><div style="width:100%;height:6px;background:#e0e0e0;border-radius:3px;overflow:hidden"><div style="width:${pct};height:100%;background:${color};border-radius:3px"></div></div></div>`;
    }
    case 'alert': {
      const colors: Record<string, string> = { success: '#4caf50', warning: '#ff9800', error: '#f44336', info: '#2196f3' };
      const icons: Record<string, string> = { success: '✓', warning: '⚠', error: '✕', info: 'ℹ' };
      const bgTints: Record<string, string> = { success: '#edf7ed', warning: '#fff4e5', error: '#fde7e9', info: '#e3f2fd' };
      const v = w.variant || 'info';
      return `<div style="${style}background:${bgTints[v]};border-left:4px solid ${colors[v]};border-radius:4px;padding:10px 14px;display:flex;align-items:center;gap:8px"><span style="color:${colors[v]};font-weight:bold;font-size:16px">${icons[v]}</span><span style="font-size:13px;color:#333">${w.label}</span></div>`;
    }
    case 'typography': {
      const color = w.color || '#333';
      return `<div style="${style}font-size:${w.fontSize || 16}px;font-weight:${w.fontWeight || 'normal'};color:${color}">${w.label}</div>`;
    }
    case 'checkbox': {
      const checked = w.checked;
      return `<label style="${style}display:flex;align-items:center;gap:6px;font-size:14px;cursor:pointer"><div style="width:18px;height:18px;border:2px solid ${w.color || '#666'};border-radius:3px;background:${checked ? (w.color || palette.primary) : '#fff'};display:flex;align-items:center;justify-content:center">${checked ? '<span style="color:#fff;font-size:12px;font-weight:bold">✓</span>' : ''}</div>${w.label}</label>`;
    }
    case 'radio': {
      const checked = w.checked;
      return `<label style="${style}display:flex;align-items:center;gap:6px;font-size:14px;cursor:pointer"><div style="width:18px;height:18px;border:2px solid ${w.color || '#666'};border-radius:50%;background:#fff;position:relative">${checked ? `<div style="width:10px;height:10px;border-radius:50%;background:${w.color || palette.primary};position:absolute;top:2px;left:2px"></div>` : ''}</div>${w.label}</label>`;
    }
    case 'iconbutton': {
      return `<button style="${style}width:36px;height:36px;border-radius:50%;border:none;background:transparent;color:${w.color || '#666'};cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px" title="${w.icon}">{{${w.icon}}}</button>`;
    }
    case 'card': {
      const shadow = w.elevation ? `box-shadow:0 ${w.elevation}px ${w.elevation * 2}px rgba(0,0,0,0.15);` : '';
      return `<div style="${style}background:${w.bgColor || '#fff'};border-radius:8px;padding:16px;${shadow}border:1px solid #e0e0e0"><div style="font-weight:600;font-size:15px;margin-bottom:8px">${w.label}</div><div style="font-size:13px;color:#666">Content area</div></div>`;
    }
    case 'table-row': {
      const cells = (w.items || []).map(item => `<td style="padding:6px 12px;font-size:13px;border-bottom:1px solid #e0e0e0">${item}</td>`).join('');
      return `<tr style="background:${w.bgColor || '#fff'}"><td style="padding:6px 12px;font-size:13px;font-weight:500;border-bottom:1px solid #e0e0e0">${w.label}</td>${cells}</tr>`;
    }
    default:
      return `<div style="${style}font-size:14px">${w.label}</div>`;
  }
}

// ─── Render full layout to HTML ────────────────────────────────────────────
function renderLayoutHtml(layout: LayoutDef, size: number): string {
  const { palette, density, sections, title, type } = layout;
  const isDark = palette.name === 'dark';
  const textColor = isDark ? '#e0e0e0' : '#333';
  const cardBg = isDark ? '#333' : '#fff';
  const sectionBg = isDark ? '#424242' : '#fff';
  const gap = density === 'dense' ? '4px' : density === 'sparse' ? '16px' : '8px';

  const isRow = type === 'card-grid' || type === 'split';
  const flexDirection = isRow ? 'row' : 'column';

  let sectionsHtml = '';
  for (const section of sections) {
    let widgetsHtml = section.widgets.map(w => renderWidgetHtml(w, palette)).join('\n');
    
    // If any widget is a table-row, wrap in table
    if (section.widgets.some(w => w.type === 'table-row')) {
      const tableRows = section.widgets.filter(w => w.type === 'table-row').map(w => renderWidgetHtml(w, palette)).join('\n');
      const nonTableWidgets = section.widgets.filter(w => w.type !== 'table-row').map(w => renderWidgetHtml(w, palette)).join('\n');
      widgetsHtml = nonTableWidgets + `<table style="width:100%;border-collapse:collapse;margin:8px 0"><thead><tr style="background:${palette.primary}22"><th style="padding:6px 12px;text-align:left;font-size:12px;font-weight:600;color:${textColor}">Name</th>${section.widgets[0]?.items?.map(() => `<th style="padding:6px 12px;text-align:left;font-size:12px;font-weight:600;color:${textColor}">Value</th>`).join('') || ''}</tr></thead><tbody>${tableRows}</tbody></table>`;
    }

    const sectionWidth = type === 'card-grid' ? `calc(50% - ${gap})` : type === 'split' ? '50%' : '100%';
    sectionsHtml += `<div style="background:${sectionBg};border-radius:8px;padding:${density === 'dense' ? '8' : density === 'sparse' ? '20' : '14'}px;border:1px solid ${isDark ? '#555' : '#e0e0e0'};${type === 'card-grid' || type === 'split' ? `width:${sectionWidth};` : ''}flex-shrink:0"><div style="font-weight:600;font-size:${density === 'dense' ? '13' : '15'}px;margin-bottom:${gap};color:${palette.primary};text-transform:uppercase;letter-spacing:0.5px">${section.title}</div>${widgetsHtml}</div>`;
  }

  // Sidebar layout
  let sidebarHtml = '';
  let mainHtml = sectionsHtml;
  if (type === 'sidebar') {
    const navItems = pickN(NAMES, randInt(4, 8, mulberry32(42)), mulberry32(42));
    sidebarHtml = `<div style="width:180px;background:${isDark ? '#333' : '#fafafa'};padding:12px;border-right:1px solid ${isDark ? '#555' : '#e0e0e0'};flex-shrink:0"><div style="font-weight:700;font-size:16px;color:${palette.primary};margin-bottom:16px">${title}</div>${navItems.map((item, i) => `<div style="padding:8px 12px;border-radius:4px;font-size:13px;color:${i === 0 ? '#fff' : textColor};background:${i === 0 ? palette.primary : 'transparent'};margin-bottom:2px;cursor:pointer">${item}</div>`).join('\n')}</div>`;
    mainHtml = sectionsHtml;
  }

  const bodyContent = type === 'sidebar'
    ? `<div style="display:flex;height:100%;width:100%">${sidebarHtml}<div style="flex:1;padding:${gap};display:flex;flex-direction:column;gap:${gap};overflow-y:auto">${mainHtml}</div></div>`
    : type === 'dashboard'
    ? `<div style="padding:${gap};display:flex;flex-direction:column;gap:${gap};height:100%;width:100%"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:${gap}"><h1 style="font-size:${density === 'dense' ? '18' : '22'}px;margin:0;color:${textColor}">${title}</h1><div style="display:flex;gap:8px">${renderWidgetHtml({ type: 'iconbutton', icon: 'search', color: textColor, margin: '0', padding: '0' }, palette)}${renderWidgetHtml({ type: 'iconbutton', icon: 'settings', color: textColor, margin: '0', padding: '0' }, palette)}</div></div>${mainHtml}</div>`
    : `<div style="padding:${gap};display:flex;flex-direction:${flexDirection};flex-wrap:${isRow ? 'wrap' : 'nowrap'};gap:${gap};height:100%;width:100%"><h1 style="font-size:20px;width:100%;margin:0 0 ${gap} 0;color:${textColor}">${title}</h1>${mainHtml}</div>`;

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=${size},height=${size}">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${size}px; height: ${size}px; overflow: hidden; font-family: 'Roboto', 'Helvetica', 'Arial', sans-serif; }
  body { background: ${palette.bg}; color: ${textColor}; }
  button:hover { opacity: 0.9; }
  input:focus { border-color: ${palette.primary} !important; }
</style>
</head><body>${bodyContent}</body></html>`;
}

// ─── Generate questions about specific widgets ────────────────────────────
function generateUIQuestions(layout: LayoutDef, sampleId: string): Question[] {
  const questions: Question[] = [];
  const rng = mulberry32(layout.widgets.length * 7 + 1);
  const widgets = layout.widgets;

  // 1. Button questions
  const buttons = widgets.filter(w => w.type === 'button');
  if (buttons.length > 0) {
    const btn = pick(buttons, rng);
    questions.push({
      id: `${sampleId}|button-label`,
      sampleId,
      prompt: `What text is displayed on the ${btn.variant || ''} button in this UI screenshot? Answer with just the button text.`,
      answerTemplate: btn.label,
    });
    if (btn.variant === 'contained' && btn.color) {
      questions.push({
        id: `${sampleId}|button-color`,
        sampleId,
        prompt: `What is the background color of the "${btn.label}" button? Answer with the CSS color name or hex value.`,
        answerTemplate: btn.color,
      });
    }
  }

  // 2. Count questions
  questions.push({
    id: `${sampleId}|count-buttons`,
    sampleId,
    prompt: `How many buttons are visible in this screenshot? Answer with just the number.`,
    answerTemplate: String(buttons.length),
  });

  const switches = widgets.filter(w => w.type === 'switch');
  if (switches.length > 0) {
    questions.push({
      id: `${sampleId}|count-switches`,
      sampleId,
      prompt: `How many toggle switches are visible in this screenshot? Answer with just the number.`,
      answerTemplate: String(switches.length),
    });
    const sw = pick(switches, rng);
    questions.push({
      id: `${sampleId}|switch-state`,
      sampleId,
      prompt: `Is the "${sw.label}" switch ON or OFF?`,
      answerTemplate: sw.checked ? 'ON' : 'OFF',
    });
  }

  // 3. Chip/badge questions
  const chips = widgets.filter(w => w.type === 'chip');
  if (chips.length > 0) {
    const chip = pick(chips, rng);
    questions.push({
      id: `${sampleId}|chip-label`,
      sampleId,
      prompt: `What text is displayed on the ${chip.variant} chip/tag in this UI? Answer with just the text.`,
      answerTemplate: chip.label,
    });
  }

  const badges = widgets.filter(w => w.type === 'badge');
  if (badges.length > 0) {
    const badge = pick(badges, rng);
    questions.push({
      id: `${sampleId}|badge-count`,
      sampleId,
      prompt: `What number appears on the badge for "${badge.label}"? Answer with just the number.`,
      answerTemplate: String(badge.value),
    });
  }

  // 4. Progress/slider value questions
  const sliders = widgets.filter(w => w.type === 'slider');
  if (sliders.length > 0) {
    const slider = pick(sliders, rng);
    questions.push({
      id: `${sampleId}|slider-value`,
      sampleId,
      prompt: `What percentage is the "${slider.label}" slider set to? Answer with just the number.`,
      answerTemplate: String(slider.value),
    });
  }

  const progressBars = widgets.filter(w => w.type === 'progress');
  if (progressBars.length > 0) {
    const prog = pick(progressBars, rng);
    questions.push({
      id: `${sampleId}|progress-value`,
      sampleId,
      prompt: `What percentage is shown on the "${prog.label}" progress bar? Answer with just the number.`,
      answerTemplate: String(prog.value),
    });
  }

  // 5. Alert variant questions
  const alerts = widgets.filter(w => w.type === 'alert');
  if (alerts.length > 0) {
    const alert = pick(alerts, rng);
    questions.push({
      id: `${sampleId}|alert-type`,
      sampleId,
      prompt: `What type of alert is shown in this UI? (success, warning, error, or info)`,
      answerTemplate: alert.variant || 'info',
    });
    questions.push({
      id: `${sampleId}|alert-message`,
      sampleId,
      prompt: `What does the alert message say? Transcribe the full text.`,
      answerTemplate: alert.label,
    });
  }

  // 6. Checkbox/radio state questions
  const checkboxes = widgets.filter(w => w.type === 'checkbox');
  if (checkboxes.length > 0) {
    const cb = pick(checkboxes, rng);
    questions.push({
      id: `${sampleId}|checkbox-state`,
      sampleId,
      prompt: `Is the "${cb.label}" checkbox checked or unchecked?`,
      answerTemplate: cb.checked ? 'checked' : 'unchecked',
    });
  }

  // 7. Overall layout questions
  questions.push({
    id: `${sampleId}|section-count`,
    sampleId,
    prompt: `How many distinct sections or panels are visible in this UI? Answer with just the number.`,
    answerTemplate: String(layout.sections.length),
  });

  questions.push({
    id: `${sampleId}|title`,
    sampleId,
    prompt: `What is the title or heading of this UI page? Answer with just the title text.`,
    answerTemplate: layout.title,
  });

  questions.push({
    id: `${sampleId}|density`,
    sampleId,
    prompt: `How would you describe the density of this UI layout? (sparse, normal, or dense)`,
    answerTemplate: layout.density,
  });

  // 8. Color scheme question
  questions.push({
    id: `${sampleId}|color-scheme`,
    sampleId,
    prompt: `What is the primary accent color used in this UI? Answer with a CSS color name or hex.`,
    answerTemplate: layout.palette.primary,
  });

  return questions;
}

// ─── Main generator ────────────────────────────────────────────────────────
export async function* generateUISamples(cfg: UIBenchmarkConfig): AsyncGenerator<Sample> {
  const sizes = cfg.sizes ?? [{ width: 512, height: 512 }];
  const seed = cfg.seed ?? 42;
  const densities = cfg.densities ?? ['sparse', 'normal', 'dense'];

  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.default.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  try {
    for (let si = 0; si < sizes.length; si++) {
      const size = sizes[si];
      const dim = Math.min(size.width, size.height);
      
      // Generate layouts for each density and variation
      for (let di = 0; di < densities.length; di++) {
        const density = densities[di];
        for (let vi = 0; vi < (cfg.variationsPerDensity ?? 4); vi++) {
          const sampleSeed = seed + si * 1000 + di * 100 + vi;
          const rng = mulberry32(sampleSeed);
          
          // Force density
          const layout = generateLayout(rng);
          layout.density = density;
          
          const sampleId = `ui-${String(si * 100 + di * 10 + vi).padStart(3, '0')}`;
          
          // Render to HTML
          const html = renderLayoutHtml(layout, dim);
          
          // Screenshot via Puppeteer
          const page = await browser.newPage();
          await page.setViewport({ width: dim, height: dim });
          await page.setContent(html, { waitUntil: 'networkidle0', timeout: 15000 });
          // Wait a bit for fonts to load
          await new Promise(r => setTimeout(r, 500));
          const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: dim, height: dim } });
          await page.close();
          
          const imageBase64 = buf.toString('base64');
          
          // Build ground truth
          const gt: UIGroundTruth = {
            benchmark: 'ui',
            layout: layout.type,
            density: layout.density,
            palette: layout.palette.name,
            sections: layout.sections.map(s => s.title),
            widgets: layout.widgets.map(w => ({
              type: w.type,
              label: w.label,
              variant: w.variant,
              color: w.color,
              checked: w.checked,
              value: w.value,
            })),
          };
          
          // Generate questions
          const questions = generateUIQuestions(layout, sampleId);
          
          // Store questions on the ground truth for later retrieval
          (gt as any)._questions = questions;
          
          yield {
            id: sampleId,
            imageBase64,
            groundTruth: gt,
          };
        }
      }
    }
  } finally {
    await browser.close();
  }
}

// Export question generator separately since it needs the sample
export function generateUIQuestionsFromSample(sample: Sample): Question[] {
  return (sample.groundTruth as any)._questions || [];
}