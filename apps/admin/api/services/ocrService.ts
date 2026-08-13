import { GoogleGenAI } from '@google/genai';
import { createWorker } from 'tesseract.js';
import { logger } from '../../logger';

export interface OcrExtractedRaw {
  merchant: string | null;
  amount: number | null;
  currency: string | null;
  expenseDate: string | null; // YYYY-MM-DD or null (ONLY if printed on receipt)
  expenseTime: string | null; // HH:MM (24h) or null (ONLY if printed on receipt)
  description: string | null;
  rawText: string;
}

export interface AmountCandidate {
  value: number;
  score: number;
  context: string;
  matchedLabel?: string;
  hasCurrencySymbol: boolean;
  isBlacklistedIdentifier: boolean;
}

export interface OcrResult {
  merchant: string | null;
  merchantSource: 'receipt' | 'missing';
  amount: number | null;
  amountSource: 'receipt' | 'missing';
  currency: string;
  expenseDate: string; // Final application date
  dateSource: 'receipt' | 'upload_fallback';
  expenseTime: string; // Final application time
  timeSource: 'receipt' | 'upload_fallback';
  category: string | null;
  description: string | null;
  paymentMethod: string | null;
  rawText: string;
  derivedFromUploadTimestamp: boolean;
  ocrSuccess: boolean;
  confidence: number;
  fallbackReason?: string;
  extractedValues: {
    merchant: string | null;
    amount: number | null;
    date: string | null; // Null if missing on receipt
    time: string | null; // Null if missing on receipt
    category: string | null;
    paymentMethod: string | null;
  };
}

const BLACKLISTED_TERMS = new Set([
  'png', 'jpg', 'jpeg', 'pdf', 'webp', 'gif', 'bmp', 'tif', 'tiff',
  'image', 'document', 'file', 'unknown', 'null', 'undefined',
  'mimetype', 'application', 'image/png', 'image/jpeg', 'application/pdf',
  'text/plain', 'receipt', 'invoice', 'tax invoice', 'bill', 'statement', 'voucher',
  'ihdr', 'idat', 'iend', 'plte', 'phys', 'srgb', 'gama', 'exif', 'jfif'
]);

/**
 * Format a Date object into 'YYYY-MM-DD' and 'HH:MM' strings in server time.
 */
function getUploadTimestampStrings(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');

  return {
    uploadDate: `${year}-${month}-${day}`,
    uploadTime: `${hours}:${minutes}`,
  };
}

/**
 * Check if a string contains raw binary headers or OCR garbage
 */
function isGarbageText(str: string | null | undefined): boolean {
  if (!str) return true;
  const s = str.trim();
  if (s.length < 2) return true;

  // Reject binary headers & chunk tags
  if (/IHDR|IDAT|IEND|PLTE|pHYs|sRGB|gAMA|EXIF|JFIF|Adobe|Photoshop/i.test(s)) return true;
  if (BLACKLISTED_TERMS.has(s.toLowerCase())) return true;

  // Reject strings with low clean-character ratio
  const cleanChars = (s.match(/[A-Za-z0-9\s&'.,-]/g) || []).length;
  if (cleanChars / s.length < 0.5) return true;

  return false;
}

// Header noise lines that appear at the top of receipts
const HEADER_NOISE_REGEX = /^(?:welcome(?:\s+to(?:\s+our\s+store)?)?|thank\s*you(?:\s*for\s*visiting)?|thanks|tax\s*invoice|retail\s*invoice|invoice|cash\s*memo|estimate|bill\s*of\s*supply|credit\s*note|debit\s*note|original\s*(?:copy)?|duplicate\s*(?:copy)?|customer\s*(?:copy)?|merchant\s*copy)$/i;

// Generic corporate and business type terms for scoring and multi-line detection (NO hardcoded specific brand names)
const BUSINESS_ENTITY_SUFFIX_REGEX = /\b(?:pvt|private|ltd|limited|inc|corp|corporation|llp|co|company|solutions|services|enterprises|traders|trading|supermarket|hypermarket|retail|bazaar|mart|store|stores|express|agency|agencies|industries|infotech|technologies|cafe|coffee|bakery|sweets|restaurant|diner|bistro|kitchen|hotel|resort|hospital|pharma|pharmacy|medical|medicals|diagnostics|motors|auto|automobiles|jewellers|textiles|silks|fashions|garments|hardware|electricals|stationery|bookstore|studio|spa|salon)\b/i;

// Corporate legal endings that signify line 1 is already a complete corporate entity name
const CORPORATE_LEGAL_ENDINGS_REGEX = /\b(?:ltd|limited|inc|corp|corporation|llp|pvt\s+ltd|private\s+limited)\b$/i;

function cleanSingleLineMerchant(lineStr: string): string | null {
  if (!lineStr) return null;
  let str = lineStr.trim();
  if (isGarbageText(str)) return null;

  // Remove leading prefixes like "Merchant:", "Store Name:", "Vendor:", "Billed By:", "From:", "Seller:"
  str = str.replace(/^(?:merchant|store\s*name|store|vendor|shop|billed\s+by|from|business|company|firm|outlet|branch|seller|supplier|sold\s+by)[:\s-]+/i, '').trim();

  // Remove header noise prefixes like "WELCOME TO", "WELCOME TO OUR STORE", "TAX INVOICE"
  str = str.replace(/^(?:welcome(?:\s+to(?:\s+our\s+store)?)?|thank\s*you(?:\s*for\s*visiting)?|thanks|tax\s*invoice|retail\s*invoice|cash\s*memo|estimate|bill\s*of\s*supply|credit\s*note|debit\s*note|original\s*(?:copy)?|duplicate\s*(?:copy)?|customer\s*(?:copy)?|merchant\s*copy)[:\s-]+/i, '').trim();

  // Remove trailing or inline GSTIN / GST / FSSAI / VAT / TIN / PAN / CIN / Trade Lic numbers
  str = str.replace(/\b(?:GSTIN|GST|FSSAI|VAT|TIN|PAN|CIN|TAX\s*ID|REG\s*NO|TRADE\s*LIC)[:\s]*[A-Z0-9\/-]+\b/gi, '');
  str = str.replace(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/gi, ''); // GSTIN standard regex pattern
  str = str.replace(/\b\d{14}\b/g, ''); // FSSAI 14-digit number

  // Remove phone numbers / contact numbers / emails / URLs
  str = str.replace(/\b(?:ph|phone|tel|mobile|mob|cell|fax|contact|call)[:\s]*\+?\d[\d\s\(\)\-]{7,}\b/gi, '');
  str = str.replace(/\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3,5}\)?[-.\s]?\d{3,5}[-.\s]?\d{3,5}\b/g, (m) => {
    const digits = m.replace(/\D/g, '');
    return digits.length >= 9 && digits.length <= 13 ? '' : m;
  });
  str = str.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '');
  str = str.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '');

  // Remove invoice / bill / receipt / order / date / time labels and numbers
  str = str.replace(/\b(?:tax\s+invoice|retail\s*invoice|invoice|inv|bill|receipt|sl\s*no|order|ref|cashier|pos|token|counter)[:\s#].*/gi, '');

  // Strip address suffixes if appended after store name (e.g. "Reliance Smart Superstore, 123 Main Road Bengaluru")
  const addressBreakRegex = /(?:,\s*|\s+-\s+|\s+)(?:d\.?no\.?|h\.?no\.?|plot\s*no\.?|door\s*no\.?|shop\s*no\.?|#\d+|\d+(?:st|nd|rd|th)?[\s,]+(?:main|cross|st|rd|ave|avenue|floor|mall|road|street|block|sec|sector|phase|complex|building|bldg|plaza|tower|lane|nh-\d*|highway)|(?:main|cross|st|rd|floor|mall|road|street|block|sec|sector|phase|complex|building|bldg|plaza|tower|lane|nh-\d*|highway)\s+(?:road|street|st|rd|block|sec|sector|phase|bengaluru|bangalore|mumbai|delhi|new delhi|chennai|hyderabad|kolkata|pune|ahmedabad|gurgaon|gurugram|noida|faridabad|ghaziabad|jaipur|chandigarh|surat|kochi|trivandrum|indore|bhopal|coimbatore|mysore|nagpur|thane|karnataka|maharashtra|tamil nadu|telangana|gujarat|haryana|delhi ncr|india|\d{5,6})).*/i;
  str = str.replace(addressBreakRegex, '');

  const cityStateRegex = /(?:,\s*|\s+-\s+|\s+)(?:whitefield|koramangala|indiranagar|jayanagar|hsr\s*layout|mg\s*road|saket|powai|bandra|connaught\s*place|jubilee\s*hills|gachibowli|hitech\s*city|bengaluru|bangalore|mumbai|delhi|new delhi|chennai|hyderabad|kolkata|pune|ahmedabad|gurgaon|gurugram|noida|faridabad|ghaziabad|jaipur|chandigarh|surat|kochi|trivandrum|indore|bhopal|coimbatore|mysore|nagpur|thane|karnataka|maharashtra|tamil nadu|telangana|gujarat|haryana|delhi ncr|india)\b.*/i;
  str = str.replace(cityStateRegex, '');

  const fallbackAddressRegex = /\b(?:d\.?no\.?|h\.?no\.?|plot\s*no\.?|door\s*no\.?|shop\s*no\.?|floor|suite|flat|pincode|pin\s*\d|zip|near\s+opposite|opposite|opp\b|behind|beside|next to)\b.*/i;
  str = str.replace(fallbackAddressRegex, '');

  // Clean trailing/leading non-word symbols, dashes, commas, colons, slashes
  str = str.replace(/^[=\-\*\#\_\s:,;.|/]+|[=\-\*\#\_\s:,;.|/]+$/g, '').trim();

  // Collapse multiple spaces
  str = str.replace(/\s+/g, ' ');

  if (str.length < 2 || isGarbageText(str)) return null;
  return str;
}

/**
 * Clean raw merchant/store string to ensure it is concise, human-readable,
 * and free from addresses, GSTIN numbers, phone numbers, invoice/bill labels,
 * and OCR noise, without touching amount/date/time extraction routines.
 */
export function cleanMerchantName(rawStr: string | null | undefined): string | null {
  if (!rawStr || typeof rawStr !== 'string') return null;
  let str = rawStr.trim();
  if (isGarbageText(str)) return null;

  // Handle multi-line strings
  if (str.includes('\n')) {
    const lines = str.split('\n').map(l => l.trim()).filter(Boolean);
    const validLines: string[] = [];

    for (const line of lines) {
      if (HEADER_NOISE_REGEX.test(line)) continue;
      if (/^\b(?:gstin|fssai|pan|vat|tin|phone|tel|mob|contact|invoice|inv|bill|date|time|sl\s*no|page)[:\s]/i.test(line)) continue;

      const cleanedLine = cleanSingleLineMerchant(line);
      if (cleanedLine) {
        validLines.push(cleanedLine);
      }
    }

    if (validLines.length === 0) return null;

    if (validLines.length >= 2) {
      const line1 = validLines[0];
      const line2 = validLines[1];

      if (line2.toLowerCase().startsWith(line1.toLowerCase()) || line2.toLowerCase().includes(line1.toLowerCase())) {
        str = line2;
      } else if (
        !CORPORATE_LEGAL_ENDINGS_REGEX.test(line1) &&
        BUSINESS_ENTITY_SUFFIX_REGEX.test(line2) &&
        !/\b(?:road|street|st|rd|ave|floor|plaza|sector|city|pin|pincode|zip|near|opp|behind|gstin|phone|tel|invoice|bill|bazaar|mall|branch|store|outlet)\b/i.test(line2) &&
        (line1.length + line2.length <= 60) &&
        line1.length >= 3 &&
        !HEADER_NOISE_REGEX.test(line1)
      ) {
        str = `${line1} ${line2}`;
      } else {
        str = line1;
      }
    } else {
      str = validLines[0];
    }
  } else {
    if (HEADER_NOISE_REGEX.test(str)) return null;
    str = cleanSingleLineMerchant(str) || '';
  }

  if (!str || str.length < 2 || isGarbageText(str)) return null;
  return str;
}

/**
 * Helper to parse dates into YYYY-MM-DD
 */
function parseDateStringToIso(dateStr: string | null | undefined): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const str = dateStr.trim();
  if (!str || str.toLowerCase() === 'null' || str.toLowerCase() === 'undefined') return null;

  // Match ISO format: 2026-08-10 or 2025-05-16
  const isoMatch = str.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    if (Number(year) > 2000 && Number(year) < 2100 && Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }

  // Match DD/MM/YYYY or DD-MM-YYYY (e.g. 16/05/2025)
  const ddmmyyyyMatch = str.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (ddmmyyyyMatch) {
    const [, day, month, year] = ddmmyyyyMatch;
    if (Number(year) > 2000 && Number(year) < 2100 && Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }

  // Match text dates like "15 Jul 2026" or "July 15, 2026"
  const textDateMatch = str.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (textDateMatch) {
    const [, day, monthName, year] = textDateMatch;
    const parsedDate = new Date(`${monthName} ${day}, ${year}`);
    if (!isNaN(parsedDate.getTime())) {
      const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
      const d = String(parsedDate.getDate()).padStart(2, '0');
      return `${year}-${month}-${d}`;
    }
  }

  return null;
}

/**
 * Helper to parse time into HH:MM (24-hr format)
 */
function parseTimeStringTo24h(timeStr: string | null | undefined): string | null {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const str = timeStr.trim();
  if (!str || str.toLowerCase() === 'null' || str === '00:00' || str.toLowerCase() === 'undefined') return null;

  const time12h = str.match(/(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)/i);
  if (time12h) {
    let hours = parseInt(time12h[1], 10);
    const minutes = time12h[2];
    const period = time12h[3].toUpperCase();
    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    return `${String(hours).padStart(2, '0')}:${minutes}`;
  }

  const time24h = str.match(/(\d{1,2}):(\d{2})/);
  if (time24h) {
    const hours = String(parseInt(time24h[1], 10)).padStart(2, '0');
    const minutes = time24h[2];
    return `${hours}:${minutes}`;
  }

  return null;
}

/**
 * Multi-Pass Semantic Amount Extraction Algorithm with Candidate Scoring
 */
export function parseSemanticAmount(rawText: string): { amount: number | null; confidenceScore: number; evidence?: string } {
  if (!rawText || typeof rawText !== 'string') return { amount: null, confidenceScore: 0 };

  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
  const candidates: AmountCandidate[] = [];

  // Regex to extract numeric strings. Handles:
  //   Indian comma format:  1,500.46  /  1,25,000  /  31,429.00
  //   Plain format:         1500.46   /  1500       /  31429
  // Now includes Yen/misread Rupee symbol '¥'
  const NUMERIC_REGEX = /(?:(?:₹|rs\.?|inr|\$|€|£|¥)\s*)?(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/gi;

  const IDENTIFIER_KEYWORDS = /\b(?:invoice|inv|bill|receipt|order|transaction|trans|ref|reference|customer|gstin|gst|tax\s*id|phone|mobile|tel|hsn|sac|pin|pincode|zip|date|time|pos|store|cashier)\b/i;
  const COUNT_KEYWORDS = /\b(?:items|qty|quantity|pcs|pieces)\b/i;

  const GRAND_TOTAL_REGEX = /\b(?:grand\s+total|total\s+payable|payable\s+amount|net\s+payable|amount\s+payable|final\s+total|total\s+paid|paid\s+amount)\b/i;
  const TOTAL_REGEX = /\b(?:total\s+amount|net\s+amount|balance\s+due|amount\s+due|total)\b/i;
  const SUBTOTAL_REGEX = /\b(?:subtotal|sub\s+total|taxable\s+amount|taxable)\b/i;
  const TAX_DISCOUNT_REGEX = /\b(?:discount|gst|cgst|sgst|igst|vat|tax(?!\s*invoice))\b/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLower = line.toLowerCase();

    let match: RegExpExecArray | null;
    NUMERIC_REGEX.lastIndex = 0;

    let lastMatchEndIndex = 0;

    while ((match = NUMERIC_REGEX.exec(line)) !== null) {
      const rawNumberStr = match[1].replace(/,/g, '');
      const parsedValue = parseFloat(rawNumberStr);

      if (isNaN(parsedValue) || parsedValue <= 0 || parsedValue >= 1000000) {
        lastMatchEndIndex = match.index + match[0].length;
        continue;
      }

      const matchIndex = match.index;
      // precedingText is calculated strictly from the end of the last match (or line start)
      // to the start of the current match to avoid matching earlier counts/labels on the same line.
      const precedingText = line.substring(lastMatchEndIndex, matchIndex).toLowerCase();
      const fullLineContext = line;

      const hasCurrency = /(?:₹|rs\.?|inr|\$|€|£|¥)/i.test(line.substring(Math.max(0, matchIndex - 5), matchIndex + match[0].length));

      let score = 0;
      let matchedLabel: string | undefined;
      let isIdentifier = false;

      // 1. Identify if this number is associated with identifiers, phone numbers, or dates
      if (IDENTIFIER_KEYWORDS.test(precedingText) || COUNT_KEYWORDS.test(precedingText)) {
        if (!GRAND_TOTAL_REGEX.test(lineLower) && !TOTAL_REGEX.test(lineLower)) {
          isIdentifier = true;
          score -= 150;
        }
      }

      // Check if it's a phone number (10 digits)
      if (/^[6789]\d{9}$/.test(rawNumberStr)) {
        isIdentifier = true;
        score -= 200;
      }

      // Check if it's a year (2020-2030)
      if (parsedValue >= 2020 && parsedValue <= 2030 && !TOTAL_REGEX.test(lineLower)) {
        score -= 50;
      }

      if (!isIdentifier) {
        if (GRAND_TOTAL_REGEX.test(precedingText) || (GRAND_TOTAL_REGEX.test(lineLower) && precedingText.length > 0 && !COUNT_KEYWORDS.test(precedingText))) {
          if (COUNT_KEYWORDS.test(precedingText)) {
            score -= 100;
          } else {
            score += 100;
            matchedLabel = 'GRAND_TOTAL';
          }
        } else if (TOTAL_REGEX.test(precedingText) || (TOTAL_REGEX.test(lineLower) && precedingText.length > 0 && !COUNT_KEYWORDS.test(precedingText))) {
          if (COUNT_KEYWORDS.test(precedingText)) {
            score -= 100;
          } else if (!SUBTOTAL_REGEX.test(lineLower)) {
            score += 70;
            matchedLabel = 'TOTAL';
          } else {
            score += 30;
            matchedLabel = 'SUBTOTAL';
          }
        } else if (SUBTOTAL_REGEX.test(lineLower) || SUBTOTAL_REGEX.test(precedingText)) {
          score += 30;
          matchedLabel = 'SUBTOTAL';
        }

        if (TAX_DISCOUNT_REGEX.test(lineLower)) {
          score -= 30;
        }

        if (hasCurrency) {
          score += 15;
        }
      }

      candidates.push({
        value: parsedValue,
        score,
        context: fullLineContext,
        matchedLabel,
        hasCurrencySymbol: hasCurrency,
        isBlacklistedIdentifier: isIdentifier || score < -50,
      });

      lastMatchEndIndex = match.index + match[0].length;
    }
  }

  const validCandidates = candidates.filter((c) => !c.isBlacklistedIdentifier && c.score >= 30);
  validCandidates.sort((a, b) => b.score - a.score);

  if (validCandidates.length > 0) {
    const winner = validCandidates[0];
    return {
      amount: winner.value,
      confidenceScore: winner.score,
      evidence: winner.context,
    };
  }

  const fallbackCandidates = candidates.filter((c) => !c.isBlacklistedIdentifier && c.score > 0);
  fallbackCandidates.sort((a, b) => b.score - a.score);

  if (fallbackCandidates.length > 0) {
    const winner = fallbackCandidates[0];
    return {
      amount: winner.value,
      confidenceScore: winner.score,
      evidence: winner.context,
    };
  }

  return { amount: null, confidenceScore: 0 };
}

/**
 * Infer Category and Payment Method ONLY when high-confidence evidence exists
 */
function inferCategoryAndDetails(merchant: string | null, rawText: string): {
  category: string | null;
  description: string | null;
  paymentMethod: string | null;
} {
  if (isGarbageText(merchant) && isGarbageText(rawText)) {
    return { category: null, description: null, paymentMethod: null };
  }

  const combined = `${merchant || ''} ${rawText || ''}`.toLowerCase();

  let category: string | null = null;
  let description: string | null = null;
  let paymentMethod: string | null = null;

  if (/card|visa|mastercard|amex|debit|credit/i.test(combined)) {
    paymentMethod = 'Corporate Card';
  } else if (/upi|gpay|paytm|phonepe|qr/i.test(combined)) {
    paymentMethod = 'Corporate Card';
  } else if (/cash/i.test(combined)) {
    paymentMethod = 'Personal Payment';
  }

  if (/supermarket|grocery|mart|smart\s+bazaar|bazaar|reliance|dmart|bigbasket|swiggy|zomato|food|restaurant|cafe|starbucks|mcdonald|domino|pizza|dining|baking|sweets|hotel|basmati|rice|oil|tea|milk|banana|apple|tomato/i.test(combined)) {
    category = 'Meals & Entertainment';
    description = merchant ? `Grocery / Refreshments at ${merchant}` : 'Food & Refreshments';
  } else if (/cpu\s+repair|computer|hardware|laptop|screen\s+replacement|ram|ssd|it\s+solutions|techfix|system\s+repair/i.test(combined)) {
    category = 'IT & Hardware';
    description = merchant ? `CPU / Hardware Repair at ${merchant}` : 'IT & Hardware Repair';
  } else if (/uber|ola|cab|flight|airline|indigo|air india|fuel|petrol|hpcl|bpcl|shell|parking|toll|irctc|train|railway/i.test(combined)) {
    category = 'Travel & Transport';
    description = merchant ? `Travel / Transport (${merchant})` : 'Travel & Transport';
  } else if (/amazon|flipkart|office|depot|staples|stationery|paper|printer|cartridge|store/i.test(combined)) {
    category = 'Office Supplies';
    description = merchant ? `Office Supplies from ${merchant}` : 'Office Supplies';
  } else if (/aws|google cloud|azure|github|jetbrains|zoom|slack|software|domain|godaddy|microsoft/i.test(combined)) {
    category = 'Software & Licenses';
    description = merchant ? `Software License (${merchant})` : 'Software License';
  } else if (/course|udemy|coursera|training|workshop|conference|cert/i.test(combined)) {
    category = 'Training & Education';
    description = merchant ? `Training / Workshop at ${merchant}` : 'Training & Education';
  } else if (/electric|water|internet|airtel|jio|act|telecom|utility/i.test(combined)) {
    category = 'Utilities & Subscriptions';
    description = merchant ? `Utility / Telecom Bill (${merchant})` : 'Utility Bill';
  }

  if (isGarbageText(description)) {
    description = null;
  }

  return { category, description, paymentMethod };
}

/**
 * Pattern extraction for readable plain text receipts
 */
function extractFromRawText(rawText: string): OcrExtractedRaw {
  let merchant: string | null = null;
  let date: string | null = null;
  let time: string | null = null;

  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);

  // 1. Merchant Name Extraction:
  const merchantCandidates: { text: string; score: number }[] = [];
  const nonJunkLines = lines.filter((l) => !HEADER_NOISE_REGEX.test(l));

  for (let i = 0; i < Math.min(nonJunkLines.length, 15); i++) {
    const rawLine = nonJunkLines[i];

    // Single line candidate
    const cleanedLine = cleanMerchantName(rawLine);
    if (cleanedLine) {
      let score = 0;
      // Positional score: earlier lines near the header get higher priority
      score += Math.max(0, 35 - i * 3);

      // Generic business/company entity suffix score
      if (BUSINESS_ENTITY_SUFFIX_REGEX.test(cleanedLine)) {
        score += 20;
      }

      // Corporate legal ending bonus (e.g. Limited, Ltd, Inc, Corp, Pvt Ltd)
      if (CORPORATE_LEGAL_ENDINGS_REGEX.test(cleanedLine)) {
        score += 20;
      }

      // Specific trade / store name bonus (e.g. Store, Bazaar, Mart, Outlet, Cafe, Bakery, Restaurant, Pharmacy)
      if (/\b(?:store|stores|bazaar|mart|superstore|shop|outlet|cafe|bakery|restaurant|pharmacy|hardware)\b/i.test(cleanedLine)) {
        score += 20;
      }

      const words = cleanedLine.split(/\s+/).filter(Boolean);
      score += Math.min(words.length * 5, 20);

      // Single short word without entity suffix penalty (prevents fragments like "Relian" or "SMART" from beating full store names)
      if (words.length === 1 && cleanedLine.length < 7 && !BUSINESS_ENTITY_SUFFIX_REGEX.test(cleanedLine)) {
        score -= 15;
      }

      // Uppercase / Proper title casing bonus
      if (/^[A-Z0-9\s&'.,-]+$/.test(cleanedLine)) {
        score += 5;
      }

      merchantCandidates.push({ text: cleanedLine, score });
    }

    // 2-line combination candidate (e.g. store name + legal entity line)
    if (i < nonJunkLines.length - 1) {
      const line1 = nonJunkLines[i];
      const line2 = nonJunkLines[i + 1];
      const words1 = line1.split(/\s+/).filter(Boolean);

      // Do not combine single short header words (e.g. "SMART", "WELCOME", "TAX") with line 2
      if (words1.length > 1 || line1.length >= 7 || BUSINESS_ENTITY_SUFFIX_REGEX.test(line1)) {
        const combined2Lines = `${line1}\n${line2}`;
        const cleanedCombined = cleanMerchantName(combined2Lines);
        if (cleanedCombined && cleanedCombined.includes(' ')) {
          let score = 0;
          score += Math.max(0, 35 - i * 3);

          if (BUSINESS_ENTITY_SUFFIX_REGEX.test(cleanedCombined)) {
            score += 20;
          }

          const words = cleanedCombined.split(/\s+/).filter(Boolean);
          score += Math.min(words.length * 5, 15);

          merchantCandidates.push({ text: cleanedCombined, score });
        }
      }
    }
  }

  if (merchantCandidates.length > 0) {
    const filteredCandidates = merchantCandidates.filter((c, idx) => {
      const hasBetterSuperstring = merchantCandidates.some((other, otherIdx) => {
        if (idx === otherIdx) return false;
        return other.text.toLowerCase().includes(c.text.toLowerCase()) && other.text.length > c.text.length;
      });
      return !hasBetterSuperstring;
    });

    if (filteredCandidates.length > 0) {
      filteredCandidates.sort((a, b) => b.score - a.score);

      // Tiebreaker: If candidate #1 and candidate #2 share the same primary brand name (e.g. "Reliance"),
      // prefer the candidate that specifies the actual retail store outlet (e.g. "Reliance Smart Store")
      if (filteredCandidates.length >= 2) {
        const top1 = filteredCandidates[0];
        const top2 = filteredCandidates[1];
        const firstWord1 = top1.text.split(/\s+/)[0]?.toLowerCase();
        const firstWord2 = top2.text.split(/\s+/)[0]?.toLowerCase();

        if (firstWord1 && firstWord2 && firstWord1 === firstWord2) {
          const top2HasStore = /\b(?:store|stores|bazaar|mart|superstore|shop|outlet|cafe|bakery|restaurant|pharmacy)\b/i.test(top2.text);
          const top1HasStore = /\b(?:store|stores|bazaar|mart|superstore|shop|outlet|cafe|bakery|restaurant|pharmacy)\b/i.test(top1.text);
          if (top2HasStore && !top1HasStore) {
            merchant = top2.text;
          } else {
            merchant = top1.text;
          }
        } else {
          merchant = top1.text;
        }
      } else {
        merchant = filteredCandidates[0].text;
      }
    }
  }

  if (isGarbageText(merchant)) {
    merchant = null;
  }

  // 2. Semantic Amount Extraction:
  const amountParsed = parseSemanticAmount(rawText);

  // 3. Date Extraction (ignoring invoice numbers but keeping invoice dates):
  const dateCandidates = [...rawText.matchAll(/(\d{1,2}[-/.][0-9]{1,2}[-/.][0-9]{2,4}|\d{4}[-/.][0-9]{1,2}[-/.][0-9]{1,2})/g)];
  for (const candidate of dateCandidates) {
    const precedingStr = rawText.substring(Math.max(0, (candidate.index || 0) - 20), candidate.index || 0).toLowerCase();
    
    // Skip if it looks like an invoice/bill number rather than a date, but do NOT skip if it contains "date"
    if (
      /(?:invoice|inv|bill|receipt|order|ref|sb)\s*(?:no|num|\#|id)/i.test(precedingStr) &&
      !/date/i.test(precedingStr)
    ) {
      continue;
    }
    
    const parsedDate = parseDateStringToIso(candidate[1]);
    if (parsedDate) {
      date = parsedDate;
      break;
    }
  }

  // 4. Time Extraction:
  const timeCandidates = [...rawText.matchAll(/(\d{1,2}:\d{2}(?:\s*(?:AM|PM|am|pm))?)/gi)];
  for (const candidate of timeCandidates) {
    const precedingStr = rawText.substring(Math.max(0, (candidate.index || 0) - 15), candidate.index || 0).toLowerCase();
    const parsedTime = parseTimeStringTo24h(candidate[1]);
    if (parsedTime) {
      time = parsedTime;
      if (/time|at|pos/i.test(precedingStr)) {
        break;
      }
    }
  }

  return { merchant, amount: amountParsed.amount, currency: 'INR', expenseDate: date, expenseTime: time, description: null, rawText };
}

/**
 * Main OCR receipt processor with Dual Engine Support (Gemini 2.5 Flash Vision AI + Tesseract.js Local Engine)
 */
export async function processReceiptOcr(fileBuffer: Buffer, mimeType: string): Promise<OcrResult> {
  const { uploadDate, uploadTime } = getUploadTimestampStrings();
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  const hasPngMagic = fileBuffer.length >= 4 && fileBuffer[0] === 0x89 && fileBuffer[1] === 0x50 && fileBuffer[2] === 0x4e && fileBuffer[3] === 0x47;
  const hasJpegMagic = fileBuffer.length >= 3 && fileBuffer[0] === 0xff && fileBuffer[1] === 0xd8 && fileBuffer[2] === 0xff;
  const hasGifMagic = fileBuffer.length >= 3 && fileBuffer[0] === 0x47 && fileBuffer[1] === 0x49 && fileBuffer[2] === 0x46;
  const isTrueBinaryImage = hasPngMagic || hasJpegMagic || hasGifMagic;

  // SAFE DIAGNOSTIC LOGGING (NO RECEIPT CONTENT OR SENSITIVE DATA IS LOGGED)
  logger.info('[OCR PIPELINE DIAGNOSTIC]', {
    mimeType,
    fileSizeBytes: fileBuffer.length,
    hasApiKey: !!apiKey,
    ocrProvider: apiKey ? 'Google Gemini 2.5 Flash' : 'Tesseract.js Local OCR Engine',
    isBinaryImage: isTrueBinaryImage,
    magicBytes: fileBuffer.slice(0, 4).toString('hex'),
  });

  let rawExtracted: OcrExtractedRaw = {
    merchant: null,
    amount: null,
    currency: 'INR',
    expenseDate: null,
    expenseTime: null,
    description: null,
    rawText: '',
  };

  let ocrSuccess = false;
  let confidence = 0.5;

  // ENGINE 1: GOOGLE GEMINI 2.5 FLASH MULTIMODAL VISION AI
  if (apiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `You are a receipt OCR extraction assistant.
Your task: transcribe the receipt completely, then extract structured fields.

RULES:
- rawText: Write out ALL visible text from the receipt VERBATIM, line by line. Do NOT summarize. Include every number, every label, every line exactly as printed.
- merchant: Business name printed at the top of the receipt. null if not visible.
- amount: The FINAL amount the customer paid. Look for "Grand Total", "Total Payable", "Net Payable", "Amount Paid" labels. Return only the numeric value (e.g. 1500.46). NEVER return invoice numbers, bill numbers, reference numbers, phone numbers, HSN codes, GST numbers, item quantities, or any identifier number. If uncertain, return null.
- expenseDate: Date on the receipt in YYYY-MM-DD format. null if not visible.
- expenseTime: Time on the receipt in HH:MM 24h format. null if not visible.
- description: Short summary of item categories purchased. null if unreadable.

Return ONLY a JSON object with exactly these keys: merchant, amount, expenseDate, expenseTime, description, rawText.
No markdown fences, no prose outside the JSON.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  data: fileBuffer.toString('base64'),
                  mimeType: mimeType || (hasPngMagic ? 'image/png' : 'image/jpeg'),
                },
              },
              { text: prompt },
            ],
          },
        ],
      });

      const responseText = response.text || '';
      logger.info('[OCR GEMINI RAW RESPONSE]', { responseText });
      const cleanJson = responseText.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      rawExtracted.merchant = cleanMerchantName(parsed.merchant);

      // Always run label-aware semantic parser on the full verbatim transcript.
      // This correctly identifies GRAND TOTAL / Total Payable vs invoice numbers.
      const geminiDirectAmount = typeof parsed.amount === 'number' ? parsed.amount : (parseFloat(String(parsed.amount ?? '')) || null);
      const fullTranscript = typeof parsed.rawText === 'string' && parsed.rawText.length > 20 ? parsed.rawText : responseText;
      const semanticParsed = parseSemanticAmount(fullTranscript);

      logger.info('[OCR GEMINI AMOUNT DEBUG]', {
        geminiDirectAmount,
        semanticAmount: semanticParsed.amount,
        semanticEvidence: semanticParsed.evidence,
        semanticScore: semanticParsed.confidenceScore,
      });

      // Prefer semantic parser (label-aware scorer picks GRAND TOTAL correctly)
      // Fall back to Gemini's own extracted amount only if semantic parser returns null
      rawExtracted.amount = semanticParsed.amount ?? geminiDirectAmount;

      rawExtracted.expenseDate = parseDateStringToIso(parsed.expenseDate || parsed.date);
      rawExtracted.expenseTime = parseTimeStringTo24h(parsed.expenseTime || parsed.time);
      rawExtracted.rawText = parsed.rawText || responseText;
      ocrSuccess = true;
      confidence = 0.95;
    } catch (err: any) {
      logger.warn('[OCR GEMINI MODEL CALL FAILED]', { error: err.message });
    }
  }

  // ENGINE 2: TESSERACT.JS LOCAL OCR ENGINE (FOR BINARY IMAGES WHEN NO CLOUD KEY IS SET OR WHEN CALL FAILS)
  if (!ocrSuccess && isTrueBinaryImage) {
    try {
      const worker = await createWorker('eng');
      const ret = await worker.recognize(fileBuffer);
      await worker.terminate();

      const ocrText = ret.data.text || '';
      if (ocrText.trim()) {
        // Log first 2000 chars of raw OCR text so we can diagnose extraction issues
        logger.info('[OCR TESSERACT RAW TEXT PREVIEW]', { rawTextPreview: ocrText.slice(0, 2000) });
        const parsed = extractFromRawText(ocrText);
        rawExtracted.merchant = cleanMerchantName(parsed.merchant);
        rawExtracted.amount = parsed.amount;
        rawExtracted.expenseDate = parsed.expenseDate;
        rawExtracted.expenseTime = parsed.expenseTime;
        rawExtracted.rawText = ocrText;
        ocrSuccess = !!(rawExtracted.amount || rawExtracted.merchant || rawExtracted.expenseDate);

        logger.info('[OCR TESSERACT LOCAL OCR RESULT]', {
          extractedMerchant: rawExtracted.merchant,
          extractedAmount: rawExtracted.amount,
          extractedDate: rawExtracted.expenseDate,
          extractedTime: rawExtracted.expenseTime,
          textLength: ocrText.length,
        });
      }
    } catch (tessErr: any) {
      logger.warn('[OCR TESSERACT FAILED]', { error: tessErr.message });
    }
  }

  // ENGINE 3: READABLE TEXT STREAM / FALLBACK PARSER
  if (!ocrSuccess && !isTrueBinaryImage) {
    const textSnippet = fileBuffer.toString('utf-8');
    rawExtracted = extractFromRawText(textSnippet);
    rawExtracted.merchant = cleanMerchantName(rawExtracted.merchant);
    ocrSuccess = !!(rawExtracted.amount || rawExtracted.merchant || rawExtracted.expenseDate);

    logger.info('[OCR LOCAL TEXT PARSER RESULT]', {
      extractedMerchant: rawExtracted.merchant,
      extractedAmount: rawExtracted.amount,
      extractedDate: rawExtracted.expenseDate,
      extractedTime: rawExtracted.expenseTime,
    });
  }

  // Final sanitization check against binary garbage & merchant cleaning
  rawExtracted.merchant = cleanMerchantName(rawExtracted.merchant);

  // Infer Category & Description ONLY from valid text
  const inferred = inferCategoryAndDetails(rawExtracted.merchant, rawExtracted.rawText);

  // --- STRICT SEPARATION: APPLICATION FALLBACK LAYER ---
  let finalExpenseDate: string;
  let finalExpenseTime: string;
  let dateSource: 'receipt' | 'upload_fallback' = 'upload_fallback';
  let timeSource: 'receipt' | 'upload_fallback' = 'upload_fallback';
  let amountSource: 'receipt' | 'missing' = rawExtracted.amount ? 'receipt' : 'missing';
  let merchantSource: 'receipt' | 'missing' = rawExtracted.merchant ? 'receipt' : 'missing';
  let derivedFromUploadTimestamp = false;
  let fallbackReason: string | undefined;

  // CASE A / B: Date handling
  if (rawExtracted.expenseDate) {
    finalExpenseDate = rawExtracted.expenseDate;
    dateSource = 'receipt';
  } else {
    finalExpenseDate = uploadDate;
    dateSource = 'upload_fallback';
    derivedFromUploadTimestamp = true;
  }

  // CASE A / C: Time handling
  if (rawExtracted.expenseTime) {
    finalExpenseTime = rawExtracted.expenseTime;
    timeSource = 'receipt';
  } else {
    finalExpenseTime = uploadTime;
    timeSource = 'upload_fallback';
    derivedFromUploadTimestamp = true;
  }

  if (dateSource === 'receipt' && timeSource === 'receipt') {
    fallbackReason = 'Extracted exact date and time from receipt.';
  } else if (dateSource === 'receipt' && timeSource === 'upload_fallback') {
    fallbackReason = 'Extracted date from receipt. Time derived from server upload timestamp.';
  } else if (dateSource === 'upload_fallback' && timeSource === 'receipt') {
    fallbackReason = 'Extracted time from receipt. Date derived from server upload timestamp.';
  } else {
    fallbackReason = 'Could not detect date/time on receipt. Derived from server upload timestamp.';
  }

  const hasExtractedRealFields = !!(rawExtracted.amount || rawExtracted.merchant || (rawExtracted.expenseDate && dateSource === 'receipt'));

  return {
    merchant: rawExtracted.merchant,
    merchantSource,
    amount: rawExtracted.amount,
    amountSource,
    currency: 'INR',
    expenseDate: finalExpenseDate,
    dateSource,
    expenseTime: finalExpenseTime,
    timeSource,
    category: inferred.category,
    description: inferred.description || rawExtracted.description,
    paymentMethod: inferred.paymentMethod,
    rawText: isGarbageText(rawExtracted.rawText) ? '' : rawExtracted.rawText,
    derivedFromUploadTimestamp,
    ocrSuccess: hasExtractedRealFields,
    confidence: hasExtractedRealFields ? confidence : 0,
    fallbackReason,
    extractedValues: {
      merchant: rawExtracted.merchant,
      amount: rawExtracted.amount,
      date: rawExtracted.expenseDate, // Strict NULL if missing on receipt!
      time: rawExtracted.expenseTime, // Strict NULL if missing on receipt!
      category: inferred.category,
      paymentMethod: inferred.paymentMethod,
    },
  };
}
