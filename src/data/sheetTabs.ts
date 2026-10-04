import type { Auth } from 'firebase/auth';
import { googleAccessToken } from '@huishouden/pwa-kit/google-token';
import { googleAccessMessage } from '@huishouden/pwa-kit/feedback';
import { extractSpreadsheetId } from '../services/sheets';
import { t } from '../i18n';

/**
 * Reads the legacy Sheet's settings tabs (Cards, Categories, Alert labels) for the one-time move into
 * Spending, with read-only Sheets access the member grants in Google's window. A missing tab reads as empty.
 */

const SHEETS_READONLY = 'https://www.googleapis.com/auth/spreadsheets.readonly';

/** Read-only Sheets access from Google Identity Services (call from a tap); reused until it ends. */
export function sheetsToken(auth: Auth): Promise<string> {
  return googleAccessToken(auth, [SHEETS_READONLY], { deniedMessage: 'Google did not allow reading the Sheet.' }).catch((e: unknown) => {
    throw new Error(googleAccessMessage(e, 'Sheets') ?? (e instanceof Error ? e.message : String(e)));
  });
}

async function tab(token: string, id: string, range: string): Promise<string[][]> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 400) return [];
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(res.status === 404 ? t('sheet.notFound') : t('sheet.answered', { status: res.status, detail: body.error?.message ?? res.statusText }));
  }
  return ((await res.json()) as { values?: string[][] }).values ?? [];
}

export async function readSheetTabs(token: string, link: string) {
  const id = extractSpreadsheetId(link);
  if (!id) throw new Error(t('sheet.pasteFirst'));
  const [cards, categories, labels] = await Promise.all([tab(token, id, 'Cards!A1:D'), tab(token, id, 'Categories!A1:B'), tab(token, id, "'Alert labels'!A1:A")]);
  return { cards, categories, labels };
}
