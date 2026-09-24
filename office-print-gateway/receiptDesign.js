import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultsPath = path.join(moduleDir, 'default-receipt-design.json');

export const DEFAULT_RECEIPT_DESIGN = JSON.parse(fs.readFileSync(defaultsPath, 'utf8'));

const WIDTHS = {
  '58mm': 24,
  '80mm': 32,
};

const CUT_MODES = new Set(['full', 'partial', 'none']);
const LABEL_POSITIONS = new Set(['before_header', 'after_header', 'before_footer']);
const CONTEXT_KEYS = [
  'order_number',
  'date',
  'employee',
  'location',
  'item',
  'note',
  'tokens',
  'guest_marker',
];

const DESIGN_KEYS = new Set([
  'paper_width',
  'header',
  'subheader',
  'meal_header',
  'meal_subheader',
  'footer',
  'custom_label',
  'context',
  'feed_lines',
  'cut_mode',
]);
const LABEL_KEYS = new Set(['enabled', 'text', 'position', 'bold']);
const CONTEXT_KEY_SET = new Set(CONTEXT_KEYS);

function text(value, fallback, maxLength) {
  const valueText = String(value ?? fallback).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return valueText.slice(0, maxLength);
}

export function normalizeReceiptDesign(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const custom = source.custom_label && typeof source.custom_label === 'object'
    ? source.custom_label
    : {};
  const sourceContext = source.context && typeof source.context === 'object' ? source.context : {};

  const design = {
    paper_width: source.paper_width === '58mm' ? '58mm' : '80mm',
    header: text(source.header, DEFAULT_RECEIPT_DESIGN.header, 40),
    subheader: text(source.subheader, DEFAULT_RECEIPT_DESIGN.subheader, 40),
    meal_header: text(source.meal_header, DEFAULT_RECEIPT_DESIGN.meal_header, 40),
    meal_subheader: text(source.meal_subheader, DEFAULT_RECEIPT_DESIGN.meal_subheader, 40),
    footer: text(source.footer, DEFAULT_RECEIPT_DESIGN.footer, 80),
    custom_label: {
      enabled: custom.enabled === true,
      text: text(custom.text, '', 40),
      position: LABEL_POSITIONS.has(custom.position) ? custom.position : 'after_header',
      bold: custom.bold !== false,
    },
    context: {},
    feed_lines: Number.isInteger(source.feed_lines)
      ? Math.min(8, Math.max(0, source.feed_lines))
      : DEFAULT_RECEIPT_DESIGN.feed_lines,
    cut_mode: CUT_MODES.has(source.cut_mode) ? source.cut_mode : DEFAULT_RECEIPT_DESIGN.cut_mode,
  };

  for (const key of CONTEXT_KEYS) {
    design.context[key] = key === 'guest_marker' ? true : sourceContext[key] !== false;
  }

  return design;
}

export function validateReceiptDesign(input) {
  const errors = [];
  const source = input && typeof input === 'object' ? input : {};
  const unknownDesignKeys = Object.keys(source).filter((key) => !DESIGN_KEYS.has(key));
  if (unknownDesignKeys.length) errors.push(`Unknown design field(s): ${unknownDesignKeys.join(', ')}`);

  if (source.paper_width !== undefined && !['58mm', '80mm'].includes(source.paper_width)) {
    errors.push('paper_width must be 58mm or 80mm');
  }
  for (const [key, limit] of [['header', 40], ['subheader', 40], ['meal_header', 40], ['meal_subheader', 40], ['footer', 80]]) {
    if (source[key] !== undefined && (typeof source[key] !== 'string' || source[key].length > limit)) {
      errors.push(`${key} must be text with at most ${limit} characters`);
    }
  }
  if (source.feed_lines !== undefined && (!Number.isInteger(source.feed_lines) || source.feed_lines < 0 || source.feed_lines > 8)) {
    errors.push('feed_lines must be an integer from 0 to 8');
  }
  if (source.cut_mode !== undefined && !CUT_MODES.has(source.cut_mode)) {
    errors.push('cut_mode must be full, partial, or none');
  }
  if (source.custom_label !== undefined) {
    if (!source.custom_label || typeof source.custom_label !== 'object') {
      errors.push('custom_label must be an object');
    } else {
      const unknownLabelKeys = Object.keys(source.custom_label).filter((key) => !LABEL_KEYS.has(key));
      if (unknownLabelKeys.length) errors.push(`Unknown custom_label field(s): ${unknownLabelKeys.join(', ')}`);
      if (source.custom_label.enabled !== undefined && typeof source.custom_label.enabled !== 'boolean') errors.push('custom_label.enabled must be boolean');
      if (source.custom_label.bold !== undefined && typeof source.custom_label.bold !== 'boolean') errors.push('custom_label.bold must be boolean');
      if (source.custom_label.text !== undefined && (typeof source.custom_label.text !== 'string' || source.custom_label.text.length > 40)) errors.push('custom_label.text must be text with at most 40 characters');
      if (source.custom_label.position !== undefined && !LABEL_POSITIONS.has(source.custom_label.position)) errors.push('custom_label.position is invalid');
    }
  }
  if (source.context !== undefined) {
    if (!source.context || typeof source.context !== 'object') {
      errors.push('context must be an object');
    } else {
      const unknownContextKeys = Object.keys(source.context).filter((key) => !CONTEXT_KEY_SET.has(key));
      if (unknownContextKeys.length) errors.push(`Unknown context field(s): ${unknownContextKeys.join(', ')}`);
      for (const key of Object.keys(source.context)) {
        if (typeof source.context[key] !== 'boolean') errors.push(`context.${key} must be boolean`);
      }
    }
  }
  return errors;
}

export function receiptWidth(design) {
  return WIDTHS[normalizeReceiptDesign(design).paper_width];
}

export function receiptLine(design, character = '=') {
  return character.repeat(receiptWidth(design));
}

export function clampReceiptText(value, design) {
  const width = receiptWidth(design);
  return String(value ?? '')
    .split('\n')
    .flatMap((line) => {
      if (!line) return [''];
      const chunks = [];
      for (let index = 0; index < line.length; index += width) chunks.push(line.slice(index, index + width));
      return chunks;
    });
}

export async function loadReceiptDesign(supabase, current = DEFAULT_RECEIPT_DESIGN) {
  try {
    const { data, error } = await supabase
      .from('receipt_design')
      .select('config')
      .eq('id', 'default')
      .maybeSingle();
    if (error || !data?.config) return normalizeReceiptDesign(current);
    return normalizeReceiptDesign(data.config);
  } catch {
    return normalizeReceiptDesign(current);
  }
}

export function receiptDesignForStorage(input) {
  return normalizeReceiptDesign(input);
}