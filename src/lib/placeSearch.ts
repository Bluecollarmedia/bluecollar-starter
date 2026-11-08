/**
 * Search for a US town or city by name. Pure: no React, no network. The list is the US Census Gazetteer (assets/data/us-places.json, public
 * domain), carried inside the app, so what a person types never leaves the phone. Typing a state after the name narrows it ("Lakewood NJ",
 * "Lakewood, New Jersey"). Places are ranked by how well the name matches, then by how close they are to `near` (Brighton's area), so
 * "Lakewood" gives Lakewood, NJ first. Places far from Brighton are ranked by size (land area), so "Anchorage" gives Anchorage, AK before the small one in Kentucky.
 */
export interface FoundPlace { name: string; state: string; lat: number; lon: number; area?: number }
interface Row extends FoundPlace { n: string }

const STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE',
  nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
  utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};
const STATE_CODES = new Set(Object.values(STATE_NAMES));

const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** "Name|ST|lat|lon|land area" strings -> rows. Done once; the list has about 43,000 places. */
export function parsePlaces(raw: string[]): FoundPlace[] {
  const out: Row[] = [];
  for (const s of raw) {
    const p = s.split('|');
    if (p.length < 4) continue;
    out.push({ name: p[0], state: p[1], lat: Number(p[2]), lon: Number(p[3]), area: p[4] === undefined ? 0 : Number(p[4]), n: norm(p[0]) });
  }
  return out;
}

const distKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number => {
  const r = Math.PI / 180;
  const d = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(d));
};

/** Splits "lakewood nj" / "lakewood new jersey" into the name part and the state it names (if any). */
export function splitQuery(query: string): { name: string; state: string | null } {
  const q = norm(query);
  const words = q.split(' ').filter(Boolean);
  for (const len of [2, 1]) {
    if (words.length > len) {
      const tail = words.slice(-len).join(' ');
      const st = STATE_NAMES[tail] ?? (len === 1 && STATE_CODES.has(tail.toUpperCase()) ? tail.toUpperCase() : null);
      if (st) return { name: words.slice(0, -len).join(' '), state: st };
    }
  }
  return { name: q, state: null };
}

/** The best matches for what was typed: up to `limit`, best first. Needs at least two letters. */
export function searchPlaces(list: FoundPlace[], query: string, near: { lat: number; lon: number }, limit = 8): FoundPlace[] {
  const { name, state } = splitQuery(query);
  if (name.replace(/ /g, '').length < 2) return [];
  const scored: Array<{ p: Row; rank: number; d: number }> = [];
  for (const p of list as Row[]) {
    if (state && p.state !== state) continue;
    let rank = -1;
    if (p.n === name) rank = 0;
    else if (p.n.startsWith(name)) rank = 1;
    else if (p.n.includes(' ' + name)) rank = 2;
    else if (name.length >= 3 && p.n.includes(name)) rank = 3;
    if (rank < 0) continue;
    scored.push({ p, rank, d: distKm(near, p) });
  }
  const NEAR_KM = 150;
  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const an = a.d <= NEAR_KM ? 0 : 1; const bn = b.d <= NEAR_KM ? 0 : 1;
    if (an !== bn) return an - bn;
    if (an === 0) return a.d - b.d;
    return (b.p.area ?? 0) - (a.p.area ?? 0) || a.p.name.length - b.p.name.length;
  });
  return scored.slice(0, limit).map((s) => ({ name: s.p.name, state: s.p.state, lat: s.p.lat, lon: s.p.lon }));
}
