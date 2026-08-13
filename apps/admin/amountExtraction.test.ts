import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSemanticAmount, processReceiptOcr } from './api/services/ocrService';

test('TEST 1: Invoice No: 31429 vs TOTAL: ₹1,500', () => {
  const receiptText = `
    Reliance Smart Store
    Invoice No: 31429
    Date: 11/08/2026
    Item 1: Grocery ₹1,000
    Item 2: Milk ₹500
    TOTAL: ₹1,500
  `;
  const result = parseSemanticAmount(receiptText);
  assert.equal(result.amount, 1500, 'Must extract 1500, NOT 31429');
});

test('TEST 2: Invoice No: 8000 vs TOTAL: ₹1,500', () => {
  const receiptText = `
    Reliance Smart Store
    Invoice No: 8000
    Date: 11/08/2026
    TOTAL: ₹1,500
  `;
  const result = parseSemanticAmount(receiptText);
  assert.equal(result.amount, 1500, 'Must extract 1500, NOT 8000');
});

test('TEST 3: Phone number vs TOTAL: ₹1,500', () => {
  const receiptText = `
    Supermarket Mart
    Phone: 9876543210
    Subtotal: ₹1,500
    TOTAL PAYABLE: ₹1,500
  `;
  const result = parseSemanticAmount(receiptText);
  assert.equal(result.amount, 1500, 'Must extract 1500, NOT phone number');
});

test('TEST 4: Subtotal: ₹1,300 + GST: ₹200 vs TOTAL: ₹1,500', () => {
  const receiptText = `
    DineInn Restaurant
    Subtotal: ₹1,300
    CGST 9%: ₹100
    SGST 9%: ₹100
    NET PAYABLE: ₹1,500
  `;
  const result = parseSemanticAmount(receiptText);
  assert.equal(result.amount, 1500, 'Must extract 1500 (NET PAYABLE), NOT subtotal or tax');
});

test('TEST 5: Invoice No: 1500 vs TOTAL: ₹8,000', () => {
  const receiptText = `
    Office Depot
    Invoice No: 1500
    Printer Paper & Cartridges
    TOTAL AMOUNT: ₹8,000
  `;
  const result = parseSemanticAmount(receiptText);
  assert.equal(result.amount, 8000, 'Must extract 8000 (TOTAL AMOUNT), NOT Invoice No 1500');
});

test('TEST 6: Receipt has date 16/05/2025 vs upload date 11/08/2026', async () => {
  const receiptText = `
    TechFix Solutions
    Date: 16/05/2025  Time: 11:45 AM
    TOTAL: ₹8,000
  `;
  const res = await processReceiptOcr(Buffer.from(receiptText), 'text/plain');
  assert.equal(res.expenseDate, '2025-05-16', 'Date MUST be 2025-05-16, NOT upload date');
  assert.equal(res.dateSource, 'receipt', 'dateSource MUST be receipt');
});

test('TEST 7: Receipt has time 11:45 AM vs upload time 17:03', async () => {
  const receiptText = `
    TechFix Solutions
    Date: 16/05/2025  Time: 11:45 AM
    TOTAL: ₹8,000
  `;
  const res = await processReceiptOcr(Buffer.from(receiptText), 'text/plain');
  assert.equal(res.expenseTime, '11:45', 'Time MUST be 11:45, NOT upload time');
  assert.equal(res.timeSource, 'receipt', 'timeSource MUST be receipt');
});

test('TEST 8: Receipt has no date -> fallback to upload date', async () => {
  const receiptText = `
    TechFix Solutions
    Time: 11:45 AM
    TOTAL: ₹8,000
  `;
  const res = await processReceiptOcr(Buffer.from(receiptText), 'text/plain');
  assert.equal(res.dateSource, 'upload_fallback', 'dateSource MUST be upload_fallback when missing');
});

test('TEST 9: Receipt has no time -> fallback to upload time', async () => {
  const receiptText = `
    TechFix Solutions
    Date: 16/05/2025
    TOTAL: ₹8,000
  `;
  const res = await processReceiptOcr(Buffer.from(receiptText), 'text/plain');
  assert.equal(res.timeSource, 'upload_fallback', 'timeSource MUST be upload_fallback when missing');
});

test('TEST 10: Saket Receipt (945.00 vs Items: 6, Date 16/05/2025, Time 11:45 AM)', async () => {
  const receiptText = `
    Relian
    SMART
    Reliance Retail Limited
    Reliance Smart Store, 3rd Floor, City Centre Mall,
    Saket, New Delhi - 110017
    Phone: 011-40123456 | GSTIN: 07AABCR1718E1ZQ
    TAX INVOICE
    Invoice No.  : 31429 Store Code $1023
    Invoice Date : 16/05/2025 POS ID 107
    Invoice Time : 11:45 AM Bill Type : Retail
    Cashier : RAMESH KUMAR Place of Supply : Delhi
    Sr. No. Description HSN Qty Rate (3) Amount (%)
    1 Fortune Sunlite Refined Oil 1L 15121110 1 180.00 180.00
    2 Aashirvaad Atta 5kg 11010010 il 249.00 249.00
    3 Amul Toned Milk 1L 04012010 2 30.00 60.00
    4 Tata Tea Premium 250g 09023010 il 135.00 135.00
    5 Surf Excel Matic 1kg 34022020 il 199.00 199.00
    6 Colgate Strong Teeth 200g 33061000 TU 99.00 99.00
    Subtotal 922.88
    Discount -22.88
    Taxable Amount 900.00
    CGST @ 2.5% (322.50) 22.50
    SGST @ 2.5% (322.50) 22.50
    TOTAL AMOUNT 945.00
    Total Items: 6 TOTAL PAYABLE: ¥945.00
    (Rupees Nine Hundred Forty Five Only)
    Payment Mode: UPI UPI Ref No.: 512345678901
  `;
  const res = await processReceiptOcr(Buffer.from(receiptText), 'text/plain');
  assert.equal(res.amount, 945.00, 'Must extract 945.00, NOT 6 or 31429');
  assert.equal(res.merchant, 'Reliance Smart Store', 'Must extract Reliance Smart Store, NOT Relian');
  assert.equal(res.expenseDate, '2025-05-16', 'Must extract date 2025-05-16');
  assert.equal(res.expenseTime, '11:45', 'Must extract time 11:45');
});

test('TEST 11: Koramangala Receipt (1500.46, Date 11/06/2026, Time 10:42 AM)', async () => {
  const receiptText = `
    Reliance
    Reliance Retail Limited
    Smart Bazaar, Koramangala
    80 Feet Road, Koramangala 4th Block,
    Bengaluru, Karnataka - 560034
    Phone: 080-12345678
    TAX INVOICE
    Invoice No : SB-2026-06-000123 Date © 11/06/2026
    Time : 10:42 AM Bill No © 12345
    Cashier : RAMESH K POSNo : 03
    SINo Item Description HSN Qty MRP) Price (¥) Amount (3)
    1 Daawat Rozana Basmati Rice 5kg 10063090 1 349.00 329.00 329.00
    2 Fortune Sun Lite Refined Oil 1L 15129020 2 135.00 125.00 250.00
    Sub Total 31,429.00
    GRAND TOTAL %1,500.46
  `;
  const res = await processReceiptOcr(Buffer.from(receiptText), 'text/plain');
  assert.equal(res.amount, 1500.46, 'Must extract 1500.46, NOT 31429');
  assert.equal(res.merchant, 'Reliance Retail Limited', 'Must extract Reliance Retail Limited, NOT Reliance');
  assert.equal(res.expenseDate, '2026-06-11', 'Must extract date 2026-06-11');
  assert.equal(res.expenseTime, '10:42', 'Must extract time 10:42');
});

