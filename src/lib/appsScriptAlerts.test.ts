import { describe, expect, test } from 'bun:test';
import scriptFixtures from '../../apps-script/fixtures/alerts.json';
import { DEFAULT_RULES, parseAlertEmail, type AlertCard } from '@huishouden/pwa-kit/spending-core';

// Invented cards: two share a sender, one has a sender of its own and a product word. The parser's
// own tests (and the Gmail API parity) are in the kit (test/spending-core.test.ts).
const cards: AlertCard[] = [
  { name: 'Card One', last4: '1111', alertWords: ['alerts@bank.example.com'] },
  { name: 'Card Two', last4: '2222', alertWords: ['alerts@bank.example.com', 'alerts@cardtwo.example.com', 'blue'] },
  { name: 'Card Three', last4: '3333', alertWords: [] },
];
const sent = new Date(2031, 2, 14, 12).getTime();

// The Apps Script's own fixtures: the browser reads every alert the script reads the same way
// (categories differ by design: the household's rules decide them now).
describe('reads the Apps Script fixtures like the script', () => {
  for (const f of scriptFixtures) {
    test(f.name, () => {
      const got = parseAlertEmail({ id: 'm1', date: sent, from: f.email.from, subject: f.email.subject, text: f.email.body }, cards, DEFAULT_RULES);
      if (f.expected === null) return expect(got).toBeNull();
      expect(got && { description: got.description, amount: got.amount, card: got.card, type: got.type }).toEqual({
        description: f.expected.description,
        amount: f.expected.amount,
        card: f.expected.card,
        type: f.expected.type as 'Sale' | 'Return',
      });
    });
  }
});
