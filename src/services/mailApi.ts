/**
 * Spending's alert inboxes live in the calendar Worker (huishouden/calendar, `src/mail/`): it keeps
 * each connected Gmail account's read-only access sealed and checks it every few minutes as the
 * member who connected it. These are its calls, made as the signed-in member (their Firebase ID
 * token); CORS lets only the suite's own site in.
 */

/** The Worker for this build (production or staging), from the VITE_CALENDAR_URL repository variable. Empty: no alert inboxes (the in-browser check stays). */
export const MAIL_URL = (import.meta.env.VITE_CALENDAR_URL ?? '').replace(/\/$/, '');

export interface InboxStatus {
  id: string;
  address: string;
  /** The member who connected it: the checks act as them. */
  by: string;
  mine: boolean;
  connectedAt: number;
  lastChecked: number | null;
  lastAlertAt: number | null;
  lastAdded: number | null;
  /** revoked (Reconnect), not-member, signed-out, nothing-to-search, gmail, firestore. */
  error: string | null;
  checking: boolean;
  /** The last import that read anything: "Last import: N added, M need review", and Undo. Older Workers leave it out. */
  lastImport?: LastImport | null;
  /** Emails waiting for an answer (only the member who connected the inbox sees them). */
  review?: number;
}

export interface LastImport {
  id: string;
  at: number;
  added: number;
  review: number;
  /** False while the import is still reading (more units to come). */
  done: boolean;
  undone: boolean;
}

/** An email that looked like a purchase but couldn't be read: shown to the member it was sent to. */
export interface ReviewItem {
  msg: string;
  subject: string;
  /** When it was sent (ms). */
  sent: number;
  /** The household's day it was sent (YYYY-MM-DD). */
  date: string;
  /** The first amount the email writes, to start Enter it with. */
  amount: number | null;
  reason: string;
}

export type ReviewAnswer = 'not-purchase' | 'entered';

export interface MailStatus {
  /** Whether the server can connect inboxes (its Google client is set up). */
  available: boolean;
  inboxes: InboxStatus[];
  /** The latest check of any inbox. */
  lastChecked: number | null;
}

/** Why a call failed, as the Worker says it ("not-allowed", "google-denied", "firestore-quota"); "network" when it can't be reached. */
export class MailCallError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export interface Caller {
  getIdToken(): Promise<string>;
  refreshToken: string;
}

export async function mailCall<T = MailStatus>(user: Caller, path: string, body?: Record<string, unknown>, base = MAIL_URL, fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i)): Promise<T> {
  if (!base) throw new MailCallError('not-configured');
  const idToken = await user.getIdToken();
  let res: Response;
  try {
    res = await fetchImpl(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${idToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new MailCallError('network');
  }
  const answer = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new MailCallError(answer.error ?? `http-${res.status}`);
  return answer;
}

const timeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

export const mailApi = (base = MAIL_URL) => ({
  status: (user: Caller, household: string) => mailCall(user, `/api/mail/status?household=${encodeURIComponent(household)}`, undefined, base),
  /** The refresh token goes only to the Worker, which checks it is the caller's own and acts as them with it. */
  connect: (user: Caller, household: string, code: string) => mailCall(user, '/api/mail/connect', { household, code, refreshToken: user.refreshToken, ...(timeZone() ? { timeZone: timeZone() } : {}) }, base),
  check: (user: Caller, household: string) => mailCall(user, '/api/mail/check', { household }, base),
  disconnect: (user: Caller, household: string, inbox: string) => mailCall(user, '/api/mail/disconnect', { household, inbox }, base),
  /** The inbox's emails that couldn't be read; only for the member who connected it. */
  review: (user: Caller, household: string, inbox: string) =>
    mailCall<{ items: ReviewItem[] }>(user, `/api/mail/review?household=${encodeURIComponent(household)}&inbox=${encodeURIComponent(inbox)}`, undefined, base),
  answer: (user: Caller, household: string, inbox: string, msg: string, answer: ReviewAnswer) => mailCall<{ items: ReviewItem[] }>(user, '/api/mail/review', { household, inbox, msg, answer }, base),
  /** Deletes the transactions that import wrote (as the caller). */
  undo: (user: Caller, household: string, inbox: string, importId: string) => mailCall(user, '/api/mail/undo', { household, inbox, importId }, base),
});
