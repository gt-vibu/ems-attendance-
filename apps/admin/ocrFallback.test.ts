import test from 'node:test';
import assert from 'node:assert/strict';

interface OcrExtracted {
  merchant: string | null;
  amount: number | null;
  expenseDate: string | null; // YYYY-MM-DD or null
  expenseTime: string | null; // HH:MM or null
  description: string | null;
}

interface ApplicationExpense {
  merchant: string | null;
  merchantSource: 'receipt' | 'missing';
  amount: number | null;
  amountSource: 'receipt' | 'missing';
  expenseDate: string;
  dateSource: 'receipt' | 'upload_fallback';
  expenseTime: string;
  timeSource: 'receipt' | 'upload_fallback';
  description: string | null;
}

/**
 * Deterministic Application Layer Fallback Resolver
 */
function applyApplicationFallbacks(
  ocr: OcrExtracted,
  uploadDate = '2026-08-11',
  uploadTime = '16:58'
): ApplicationExpense {
  const merchantSource = ocr.merchant ? 'receipt' : 'missing';
  const amountSource = typeof ocr.amount === 'number' && ocr.amount > 0 ? 'receipt' : 'missing';

  const dateSource = ocr.expenseDate ? 'receipt' : 'upload_fallback';
  const expenseDate = ocr.expenseDate ? ocr.expenseDate : uploadDate;

  const timeSource = ocr.expenseTime ? 'receipt' : 'upload_fallback';
  const expenseTime = ocr.expenseTime ? ocr.expenseTime : uploadTime;

  return {
    merchant: ocr.merchant,
    merchantSource,
    amount: ocr.amount,
    amountSource,
    expenseDate,
    dateSource,
    expenseTime,
    timeSource,
    description: ocr.description,
  };
}

test('CASE A: Receipt contains date AND time', () => {
  const ocr: OcrExtracted = {
    merchant: 'TechFix Solutions',
    amount: 8000,
    expenseDate: '2025-05-16',
    expenseTime: '11:45',
    description: 'CPU Repair',
  };

  const app = applyApplicationFallbacks(ocr, '2026-08-11', '16:58');

  assert.equal(app.expenseDate, '2025-05-16');
  assert.equal(app.dateSource, 'receipt');
  assert.equal(app.expenseTime, '11:45');
  assert.equal(app.timeSource, 'receipt');
  assert.equal(app.merchantSource, 'receipt');
  assert.equal(app.amountSource, 'receipt');
});

test('CASE B: Receipt contains date but NO time', () => {
  const ocr: OcrExtracted = {
    merchant: 'Reliance Fresh',
    amount: 1250,
    expenseDate: '2025-05-16',
    expenseTime: null, // No time on receipt!
    description: 'Grocery items',
  };

  const app = applyApplicationFallbacks(ocr, '2026-08-11', '16:58');

  assert.equal(app.expenseDate, '2025-05-16');
  assert.equal(app.dateSource, 'receipt');
  assert.equal(app.expenseTime, '16:58'); // Upload time fallback
  assert.equal(app.timeSource, 'upload_fallback');
});

test('CASE C: Receipt contains time but NO date', () => {
  const ocr: OcrExtracted = {
    merchant: 'Starbucks Coffee',
    amount: 350,
    expenseDate: null, // No date on receipt!
    expenseTime: '09:30',
    description: 'Coffee',
  };

  const app = applyApplicationFallbacks(ocr, '2026-08-11', '16:58');

  assert.equal(app.expenseDate, '2026-08-11'); // Upload date fallback
  assert.equal(app.dateSource, 'upload_fallback');
  assert.equal(app.expenseTime, '09:30');
  assert.equal(app.timeSource, 'receipt');
});

test('CASE D: Receipt contains neither date nor time', () => {
  const ocr: OcrExtracted = {
    merchant: 'Local Hardware',
    amount: 450,
    expenseDate: null,
    expenseTime: null,
    description: null,
  };

  const app = applyApplicationFallbacks(ocr, '2026-08-11', '16:58');

  assert.equal(app.expenseDate, '2026-08-11'); // Upload date fallback
  assert.equal(app.dateSource, 'upload_fallback');
  assert.equal(app.expenseTime, '16:58'); // Upload time fallback
  assert.equal(app.timeSource, 'upload_fallback');
});
