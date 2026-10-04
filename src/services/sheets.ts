/**
 * Text helpers from the Sheet era that statement import, category rules and the one-time move of a
 * Sheet's settings still use.
 */

/**
 * Extract Google Spreadsheet ID from either a full URL or direct ID
 */
export function extractSpreadsheetId(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  // If it's already an ID
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed;
}

/**
 * Robust CSV parser that handles quoted cells, commas, and newlines
 */
export function parseCSV(text: string, delimiter = ','): string[][] {
  const p: string[][] = [];
  let row: string[] = [''];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === delimiter && !inQuotes) {
      row.push('');
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && next === '\n') {
        i++;
      }
      if (row.length > 1 || row[0] !== '') {
        p.push(row);
      }
      row = [''];
    } else {
      row[row.length - 1] += c;
    }
  }
  if (row.length > 1 || row[0] !== '') {
    p.push(row);
  }
  return p;
}

/**
 * Whole-word match, so "rent" skips "RENT PAYMENT" but not "RENTSCHLER" or "RENTALS".
 * Hyphens count as word breaks, so "rent" still matches "RENT-A-CAR"; the default list says
 * "rent payment" for that reason.
 */
export function containsKeyword(text: string, keyword: string): boolean {
  const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text.toLowerCase());
}

/**
 * Standard list of terms to skip (mortgage, rent, card payment transfers)
 */
export const DEFAULT_IGNORED_PATTERNS = [
  'mortgage',
  'rent payment',
  'lease',
  'property management',
  'payment thank you',
  'autopay',
  'online payment',
  'chase credit crd',
  'robinhood transfer',
  'card payment',
  'direct debit mortgage',
  'escrow',
  'hoa fee',
  'salary',
  'payroll',
];

export function cleanCategoryName(cat: string): string {
  const trimmed = (cat || '').trim();
  if (!trimmed) return 'Miscellaneous';

  const lower = trimmed.toLowerCase();
  if (lower.includes('groc') || lower.includes('supermarket') || lower.includes('costco') || lower.includes('trader joe')) {
    return 'Groceries';
  }
  if (lower.includes('dining') || lower.includes('restaurant') || lower.includes('food') || lower.includes('cafe') || lower.includes('coffee') || lower.includes('doordash') || lower.includes('uber eats')) {
    return 'Dining & Food';
  }
  if (lower.includes('gas') || lower.includes('fuel') || lower.includes('ev charge') || lower.includes('transit') || lower.includes('parking') || lower.includes('uber') || lower.includes('lyft')) {
    return 'Gas & Transport';
  }
  if (lower.includes('shop') || lower.includes('amazon') || lower.includes('target') || lower.includes('clothing') || lower.includes('electronics')) {
    return 'Shopping & Retail';
  }
  if (lower.includes('sub') || lower.includes('stream') || lower.includes('netflix') || lower.includes('spotify') || lower.includes('apple') || lower.includes('software')) {
    return 'Subscriptions & Tech';
  }
  if (lower.includes('travel') || lower.includes('airline') || lower.includes('flight') || lower.includes('hotel') || lower.includes('airbnb')) {
    return 'Travel & Lodging';
  }
  if (lower.includes('entertain') || lower.includes('movie') || lower.includes('concert') || lower.includes('recreation') || lower.includes('game')) {
    return 'Entertainment';
  }
  if (lower.includes('health') || lower.includes('pharmacy') || lower.includes('doctor') || lower.includes('gym') || lower.includes('fitness') || lower.includes('wellness')) {
    return 'Health & Personal Care';
  }
  if (lower.includes('home') || lower.includes('repair') || lower.includes('hardware') || lower.includes('garden') || lower.includes('home depot')) {
    return 'Home & Garden';
  }

  // Capitalize first letter of words
  return trimmed.replace(/\b\w/g, (c) => c.toUpperCase());
}
