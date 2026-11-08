/**
 * Spanish for the push notifications the server sends to a person whose language is Español (people.language = 'es').
 * Only known system notices are translated, picked by their event type, and only when the whole text matches the exact wording the
 * database writes. Anything else (an owner's announcement, a chat or customer message, any text a person typed) is sent exactly as
 * written, never changed and never blocked. Copy these rules into a function pasted by hand in the dashboard (the functions are
 * self-contained); keep the two copies the same.
 */
const RULES: Record<string, [RegExp, string][]> = {
  // "Remind" asks a worker to confirm their schedule
  schedule_reminder: [
    [/^Please confirm your schedule$/, 'Confirma tu horario'],
    [/^(.+) (today|tomorrow|[A-Z][a-z]{2} \d{1,2}), full day\. Open the app to confirm\.$/, '$1 $2, todo el día. Abre la app para confirmar.'],
    [/^(.+) (today|tomorrow|[A-Z][a-z]{2} \d{1,2}), starts (.+)\. Open the app to confirm\.$/, '$1 $2, empieza a las $3. Abre la app para confirmar.'],
  ],
  // the mid-day "check your progress" nudge
  time_progress_check: [
    [/^Check your progress$/, 'Revisa tu avance'],
    [/^Take a moment to check how the work at (.+) is going\.?$/, 'Tómate un momento para ver cómo va el trabajo en $1.'],
  ],
};

export function spanishPush(eventType: string | null | undefined, title: string, body: string): { title: string; body: string } {
  const rules = eventType && Object.prototype.hasOwnProperty.call(RULES, eventType) ? RULES[eventType] : undefined;
  if (!rules) return { title, body };
  const tr = (s: string) => {
    for (const [re, to] of rules) if (re.test(s)) return s.replace(re, to);
    return s;
  };
  return { title: tr(title), body: body ? tr(body) : body };
}
