import { tr } from '@/i18n';

/**
 * Who checks the crew in at a maintenance property (update 68): the route's explicitly named crew leader. Owner and admin may too.
 * A route with no leader has NO implicit leader: until the owner chooses one, no worker can check in or finish a stop. The database
 * enforces the same rule; this only decides which buttons a person is shown.
 */
export function isCrewLeader(input: { leadId?: string | null; personId?: string | null; role?: string | null }): boolean {
  if (input.role === 'owner' || input.role === 'admin') return true;
  if (!input.personId) return false;
  return !!input.leadId && input.leadId === input.personId;
}

/** What a crew member who is not the leader sees at a stop, in plain words. */
export function crewStopMessage(status: string, leaderName?: string | null, arrivedTime?: string | null, arrivedBy?: string | null, hasLeader = true): string {
  if (!hasLeader && status !== 'completed' && status !== 'skipped') return tr('This route has no crew leader yet, so nobody can check in here. Ask the owner to choose a crew leader for the route.');
  const who = leaderName || tr('the crew leader');
  if (status === 'pending') return tr('Waiting for {who} to check the crew in at this property.', { who });
  if (status === 'arrived') {
    const since = arrivedTime ? ` ${tr('since {time}', { time: arrivedTime })}` : '';
    const by = arrivedBy ? ` ${tr('(checked in by {name})', { name: arrivedBy })}` : '';
    return `${tr('In progress')}${since}${by}. ${tr('{who} finishes the stop.', { who: who[0].toUpperCase() + who.slice(1) })}`;
  }
  return status === 'completed' ? tr('Finished.') : tr('Skipped.');
}

/** What the crew leader reads after tapping "Clock out the whole crew": who is out, and who could not be (and why). */
export function crewClockOutMessage(closed: string[], stillWorking: { name: string; why: string }[]): string {
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : tr('{rest} and {last}', { rest: xs.slice(0, -1).join(', '), last: xs[xs.length - 1] }));
  const out = closed.length ? tr('Clocked out: {names}.', { names: list(closed) }) : tr('Nobody was still clocked in.');
  if (!stillWorking.length) return out;
  return `${out} ${tr('Not clocked out: {names}.', { names: list(stillWorking.map((s) => `${s.name} (${tr(s.why)})`)) })} ${tr('They clock out themselves.')}`;
}
