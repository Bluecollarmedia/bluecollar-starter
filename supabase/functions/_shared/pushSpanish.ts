/**
 * Spanish for the push notifications the server sends to a person whose language is Español (people.language = 'es').
 * Anything not listed is sent exactly as written (English), never blocked. Copy these rules into a function pasted by hand in the dashboard
 * (the functions are self-contained); keep the two copies the same.
 */
const RULES: [RegExp, string][] = [
  [/^Please confirm your schedule$/, 'Confirma tu horario'],
  [/^(.+) (today|tomorrow|[A-Z][a-z]{2} \d{1,2}), full day\. Open the app to confirm\.$/, '$1 $2, todo el día. Abre la app para confirmar.'],
  [/^(.+) (today|tomorrow|[A-Z][a-z]{2} \d{1,2}), starts (.+)\. Open the app to confirm\.$/, '$1 $2, empieza a las $3. Abre la app para confirmar.'],
  [/^Check your progress$/, 'Revisa tu avance'],
  [/^Take a moment to check how the work at (.+) is going\.?$/, 'Tómate un momento para ver cómo va el trabajo en $1.'],
  [/^Storm dispatched: (.+)$/, 'Tormenta enviada: $1'],
  [/^You lead (.+) · (\d+) stops?\. Open My Route\.$/, 'Diriges $1 · $2 paradas. Abre Mi ruta.'],
  [/^You are on the crew of (.+) · (\d+) stops?\.$/, 'Estás en el equipo de $1 · $2 paradas.'],
  [/^You now lead (.+)$/, 'Ahora diriges $1'],
  [/^You were added to (.+)$/, 'Te agregaron a $1'],
  [/^(.+)\. Open My Route\.$/, '$1. Abre Mi ruta.'],
  [/^Our crew has arrived$/, 'Nuestro equipo ya llegó'],
  [/^(.+) completed$/, '$1 completado'],
  [/^(.+) at (.+)$/, '$1 en $2'],
];

export function spanishPush(title: string, body: string): { title: string; body: string } {
  const tr = (s: string) => {
    for (const [re, to] of RULES) if (re.test(s)) return s.replace(re, to);
    return s;
  };
  return { title: tr(title), body: body ? tr(body) : body };
}
