// Messages from the owner to their customers. Pure helpers: who a message can go to, checks before sending, and the sentences
// the owner sees. The database (supabase/updates/055) does the real work of finding the customers.

export type CustomerAudience = 'customers_all' | 'customers_landscaping' | 'customers_maintenance' | 'customers_snow';

export const AUDIENCES: { key: CustomerAudience; label: string; help: string }[] = [
  { key: 'customers_all', label: 'All customers', help: 'Everyone with an account: landscaping, maintenance and snow.' },
  { key: 'customers_landscaping', label: 'Landscaping', help: 'Customers with an active landscaping project.' },
  { key: 'customers_maintenance', label: 'Maintenance', help: 'Customers with a maintenance property.' },
  { key: 'customers_snow', label: 'Snow', help: 'Snow property contacts who have an account.' },
];

export const TITLE_MAX = 120;
export const BODY_MAX = 2000;

export const audienceLabel = (a: string) => AUDIENCES.find((x) => x.key === a)?.label ?? 'Customers';
export const isCustomerAudience = (a: string | undefined): a is CustomerAudience => !!a && AUDIENCES.some((x) => x.key === a);

/** Why a message can't be sent yet, or '' when it can. */
export function messageProblem(title: string, body: string): string {
  if (!title.trim()) return 'Add a title.';
  if (title.trim().length > TITLE_MAX) return `Keep the title under ${TITLE_MAX} characters.`;
  if (!body.trim()) return 'Write the message.';
  if (body.trim().length > BODY_MAX) return `Keep the message under ${BODY_MAX} characters.`;
  return '';
}

/** What to tell the owner after sending. `n` is how many people the database actually reached. */
export function sentText(n: number): string {
  if (n <= 0) return 'No customers with an account are in that group yet, so nobody was messaged.';
  return `Sent to ${n} ${n === 1 ? 'customer' : 'customers'}. They get a push notification and a banner on their home screen.`;
}

export function confirmText(audience: CustomerAudience): { title: string; message: string } {
  const who = audience === 'customers_all' ? 'all your customers' : `your ${audienceLabel(audience).toLowerCase()} customers`;
  return {
    title: 'Send this message?',
    message: `It goes to ${who} as a push notification and a banner in their app. It can't be unsent.`,
  };
}

/** The error codes and messages the database can give, in plain words. */
export function describeSendError(message: string | undefined): string {
  const m = message ?? '';
  if (/could not find the function|schema cache/i.test(m)) return "Messaging customers needs database update 55, which hasn't been installed yet.";
  if (/owner or an admin/i.test(m)) return 'Only the owner or an admin can message customers.';
  if (/title|message|who this message/i.test(m)) return m.replace(/^error:\s*/i, '');
  return m ? `The message couldn't be sent. (${m})` : "The message couldn't be sent. Please try again.";
}
