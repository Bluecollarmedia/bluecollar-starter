// Pure words for a customer's "Portal access" on their page. The owner decides whether a customer can use the app; this says in plain
// language where they stand. member status: 'active' (has a login and access), 'invited' (added, has not made a login yet, a link is out),
// 'inactive' (the owner turned access off).

export type CustomerMemberStatus = 'active' | 'invited' | 'inactive';

export interface PortalAccessView {
  /** The switch: on means the customer is allowed in (even if they have not signed up yet). */
  on: boolean;
  label: string;
  note: string;
  tone: 'success' | 'info' | 'neutral';
}

export function portalAccessView(status: string): PortalAccessView {
  if (status === 'active') return { on: true, label: 'On', tone: 'success', note: 'They can sign in and see their projects and properties.' };
  if (status === 'invited') return { on: true, label: 'Invite pending', tone: 'info', note: "They haven't made their login yet. Send them the link above and they're in." };
  return { on: false, label: 'Off', tone: 'neutral', note: "Turned off. They can't sign in or see anything. Their projects and history are kept." };
}

/** What to ask before turning access off. */
export function turnOffText(firstName: string): { title: string; message: string } {
  const who = firstName.trim() || 'this customer';
  return {
    title: `Turn off ${who}'s access?`,
    message: "They won't be able to sign in or see their projects, and any link you sent that they haven't used stops working. Their records are kept, and you can turn it back on any time.",
  };
}

/** A plain sentence for a failed change. */
export function accessErrorText(raw: unknown): string {
  const m = (raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : '').trim();
  if (/only the owner/i.test(m)) return 'Only the owner (or an admin the owner allows) can change customer access.';
  if (/network|failed to fetch|timeout/i.test(m)) return "Couldn't reach the server. Check your connection and try again.";
  if (/could not find the function|schema cache/i.test(m)) return "Turning customer access on or off needs database update 84, which hasn't been installed yet.";
  return m ? `Couldn't change their access. (${m})` : "Couldn't change their access. Please try again.";
}
