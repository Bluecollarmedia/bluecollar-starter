/** What the owner is told after tapping Remind, in plain words. Never says "sent" unless something went out. */
export interface RemindResult { sent: boolean; reason?: string; devices?: number; minutes_left?: number }

export function remindMessage(r: RemindResult, firstName: string): { tone: 'ok' | 'warn'; text: string } {
  const who = firstName || 'The worker';
  if (r.sent) {
    return (r.devices ?? 0) > 0
      ? { tone: 'ok', text: `Reminder sent to ${who}.` }
      : { tone: 'warn', text: `${who} will see the reminder in the app, but their phone is not set up for notifications, so no push went out.` };
  }
  switch (r.reason) {
    case 'recent': return { tone: 'warn', text: `You just reminded ${who}. You can remind again in ${r.minutes_left ?? 60} minute${(r.minutes_left ?? 60) === 1 ? '' : 's'}.` };
    case 'no_login': return { tone: 'warn', text: `${who} has not joined the app yet, so there is nobody to send it to. Send their invite link first.` };
    case 'confirmed': return { tone: 'ok', text: `${who} already confirmed.` };
    case 'done': return { tone: 'ok', text: 'That job is already finished.' };
    default: return { tone: 'warn', text: `Could not remind ${who}.` };
  }
}
