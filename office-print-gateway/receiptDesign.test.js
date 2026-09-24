import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_RECEIPT_DESIGN,
  normalizeReceiptDesign,
  receiptLine,
  validateReceiptDesign,
} from './receiptDesign.js';

describe('receipt design contract', () => {
  it('keeps the default output configuration intact', () => {
    assert.deepEqual(normalizeReceiptDesign({}), DEFAULT_RECEIPT_DESIGN);
  });

  it('normalizes supported admin settings and preserves required guest markers', () => {
    const design = normalizeReceiptDesign({
      paper_width: '58mm',
      header: ' Pantry ',
      custom_label: { enabled: true, text: 'PAID', position: 'before_footer' },
      context: { employee: false, guest_marker: false },
      feed_lines: 99,
    });

    assert.equal(design.paper_width, '58mm');
    assert.equal(design.header, 'Pantry');
    assert.equal(design.meal_header, DEFAULT_RECEIPT_DESIGN.meal_header);
    assert.equal(design.meal_subheader, DEFAULT_RECEIPT_DESIGN.meal_subheader);
    assert.equal(design.custom_label.text, 'PAID');
    assert.equal(design.context.employee, false);
    assert.equal(design.context.guest_marker, true);
    assert.equal(design.feed_lines, 8);
    assert.equal(receiptLine(design).length, 24);
  });

  it('rejects unknown fields and unsafe values', () => {
    const errors = validateReceiptDesign({
      paper_width: '120mm',
      unknown: true,
      meal_header: 'x'.repeat(41),
      custom_label: { text: 'x'.repeat(41) },
    });

    assert.match(errors.join(' '), /Unknown design field/);
    assert.match(errors.join(' '), /paper_width/);
    assert.match(errors.join(' '), /meal_header/);
    assert.match(errors.join(' '), /custom_label.text/);
  });
});