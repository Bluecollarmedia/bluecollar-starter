export interface AddressParts {
  address: string;
  city: string;
  state: string;
  zip: string;
}

const STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
  'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

function stateCode(s: string): string | null {
  const t = s.trim().replace(/\./g, '');
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return STATES[t.toLowerCase()] ?? null;
}

/** A street up to its "St/Ln/Ave…" word (plus any apt/unit), then the city. */
const STREET_THEN_CITY = /^(.*?\b(?:st|street|ave|avenue|ln|lane|rd|road|dr|drive|ct|court|blvd|boulevard|way|pl|place|cir|circle|ter|terrace|pkwy|parkway|hwy|highway|trl|trail|sq|square|loop|run|path|row|walk|pike|aly|alley)\b\.?(?:\s+(?:apt|unit|ste|suite|#)\s*[\w-]+)?)\s+(.+)$/i;
const COUNTRY_END = /[\s,]+(?:usa|u\.s\.a\.|us|united states(?: of america)?)\.?$/i;

/**
 * Splits a whole US address pasted or autofilled into the street field
 * ("205 Cathy Ln, Lakewood NJ 08701", "205 Cathy Ln\nLakewood, NJ 08701, United States",
 * or the same with the line breaks turned into spaces by the keyboard)
 * into its parts. Returns null when the text is just a street.
 */
export function splitAddress(text: string): AddressParts | null {
  const cleaned = text.replace(COUNTRY_END, '').trim();
  const parts = cleaned
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !/^(usa|us|united states( of america)?)$/i.test(p));
  if (parts.length === 0) return null;

  // No commas or line breaks at all ("205 Kathy Lane Lakewood NJ 08701"): needs a state and a ZIP.
  if (parts.length === 1) {
    const z = parts[0].match(/^(.*\S)\s+(\d{5})(?:-\d{4})?$/);
    if (!z) return null;
    // The state is the last word ("NJ") or last two words ("New Jersey") before the ZIP.
    const words = z[1].split(/\s+/);
    let state: string | null = null;
    let used = 0;
    for (const n of [2, 1]) {
      if (words.length > n) {
        state = stateCode(words.slice(-n).join(' '));
        if (state) { used = n; break; }
      }
    }
    if (!state) return null;
    const rest = words.slice(0, -used).join(' ');
    // The city is whatever follows the street's last "St/Ln/Ave…" word (and any unit).
    const street = rest.match(STREET_THEN_CITY);
    if (street) return { address: street[1].trim(), city: street[2].trim(), state, zip: z[2] };
    return { address: rest, city: '', state, zip: z[2] };
  }

  // Last part should end with "STATE ZIP", "STATE", or "ZIP" (state may then be its own part).
  let last = parts.pop()!;
  let zip = '';
  const zipMatch = last.match(/\s*(\d{5})(?:-\d{4})?$/);
  if (zipMatch) {
    zip = zipMatch[1];
    last = last.slice(0, zipMatch.index).trim();
  }

  let state = '';
  let city = '';
  if (last) {
    // "Lakewood NJ" or "NJ" or "New Jersey"
    const whole = stateCode(last);
    if (whole) {
      state = whole;
    } else {
      const m = last.match(/^(.*?)[\s]+([A-Za-z]{2})$/);
      if (m && stateCode(m[2])) {
        city = m[1].trim();
        state = stateCode(m[2])!;
      } else {
        city = last;
      }
    }
  }
  if (!city && parts.length >= 2) city = parts.pop()!;
  if (!state && !zip) return null;
  const address = parts.join(', ');
  if (!address) return null;
  return { address, city, state, zip };
}

/**
 * What the four address boxes should hold after the street box changed to
 * `text`. A whole address dropped in (autofill, paste) fills all four; plain
 * typing only changes the street.
 */
export function applyStreetInput(text: string, current: AddressParts): AddressParts {
  const parts = splitAddress(text);
  if (!parts) return { ...current, address: text };
  return {
    address: parts.address,
    city: parts.city || current.city,
    state: parts.state || current.state,
    zip: parts.zip || current.zip,
  };
}

export function formatAddress(a: Partial<AddressParts>): string {
  return [a.address, a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter((s) => s && s.trim()).join(', ');
}
