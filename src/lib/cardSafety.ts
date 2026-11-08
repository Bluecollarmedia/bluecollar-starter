/**
 * Payment-card guard for Company Resources. Mirrors the database checks in
 * supabase/updates/006_company_resources.sql so the owner gets a clear
 * message before saving; the database enforces the same rules regardless.
 */

/** True when the text holds a 13–19 digit run that passes the Luhn check. */
export function hasCardNumber(text?: string): boolean {
  if (!text) return false;
  const runs = text.match(/(?:\d[ -]?){12,18}\d/g) ?? [];
  return runs.some((run) => {
    const digits = run.replace(/\D/g, '');
    let total = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      total += d;
    }
    return total % 10 === 0;
  });
}

/** True when the text mentions a card PIN, CVV or security code. */
export function mentionsCardCredential(text?: string): boolean {
  if (!text) return false;
  return (
    /\b(cvv2?|cvc2?|cvn|security code)\b/i.test(text) ||
    /\bcard\b.{0,30}\bpin\b/i.test(text) ||
    /\bpin\b.{0,30}\bcard\b/i.test(text)
  );
}

export const CARD_NUMBER_MESSAGE = "That looks like a payment card number. Card numbers can't be stored in the app.";
export const CARD_PIN_MESSAGE = "Card PINs and security codes can't be stored in the app. Use the card issuer's PIN process.";
