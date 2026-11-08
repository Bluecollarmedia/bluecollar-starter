// Emailing a sent quote, change order or issued invoice to the customer. Pure helpers: the wording the customer reads (kept the same as
// supabase/functions/send-document-email), who it goes to, and what to tell the owner when it can't be sent.

export interface EmailWords { customerName: string; kind: 'quote' | 'change_order' | 'invoice'; totalText: string; dateText: string; contactEmail: string; company: string; dueText?: string }

export function buildDocumentEmailMessage(o: EmailWords) {
  const what = o.kind === 'quote' ? 'quote' : o.kind === 'invoice' ? 'invoice' : 'change order';
  const hello = o.customerName ? `Hi ${o.customerName},` : 'Hello,';
  const body = o.kind === 'quote'
    ? `Thank you for asking us to quote your project. The quote total is ${o.totalText} as of ${o.dateText}.`
    : o.kind === 'invoice'
      ? `Here is your invoice. The invoice total is ${o.totalText} as of ${o.dateText}.${o.dueText ? ` Payment is due by ${o.dueText}.` : ''}`
      : `Here is the change order for your project. The change order total is ${o.totalText} as of ${o.dateText}.`;
  const closing = `If you have any questions or concerns regarding this ${what}, please don't hesitate to get in touch with ${o.contactEmail}.`;
  return { what, hello, body, closing, sign: `Sincerely,\n${o.company}`, button: `View ${what}` };
}

export const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((v ?? '').trim());

/** The address to use: one the owner typed, else the customer's, else nothing (the app then asks). */
export function recipientFor(customerEmail: string | undefined, typed?: string): string | null {
  const t = (typed ?? '').trim();
  if (t) return looksLikeEmail(t) ? t : null;
  return looksLikeEmail(customerEmail ?? '') ? (customerEmail as string).trim() : null;
}

export const EMAIL_ERRORS: Record<string, string> = {
  email_not_configured: "Email sending isn't set up on the server yet (the Resend key is missing). Use Text Approval Link for now.",
  no_email: 'There is no email address for this customer. Type one to send it.',
  bad_email: "That doesn't look like an email address.",
  not_sent_yet: 'Mark it as sent (or issue the invoice) first. Drafts are never emailed.',
  not_allowed: 'Only the owner or an admin can email a quote.',
  sign_in_required: 'Please sign in again, then try once more.',
  not_found: "That document couldn't be found.",
  bad_request: 'The email service needs its update. Deploy send-document-email again (with database update 81 for invoices).',
  send_failed: "The email service didn't accept it. Check the sender setup in Resend, then try again.",
};

/** A sentence for the owner. `code` is the function's error code (or a raw message). */
export function describeEmailError(code: string | undefined): string {
  if (code && EMAIL_ERRORS[code]) return EMAIL_ERRORS[code];
  if (/not found|404|failed to send a request|functionsfetcherror|edge function/i.test(code ?? '')) {
    return "The email function isn't deployed yet. Deploy send-document-email in Supabase, or use Text Approval Link for now.";
  }
  return code ? `The email couldn't be sent. (${code})` : "The email couldn't be sent. Please try again.";
}
