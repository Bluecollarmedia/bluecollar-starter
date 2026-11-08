// Sorts the owner's private notes into a materials list, right on the phone: no AI, no account, no cost.
// It reads quantities ("12 yards", "40 ft", "3 rolls"), recognises common landscaping materials, and groups them. A line it does
// not recognise as a material (a measurement, a reminder, who to call) goes under "Other notes" word for word, so nothing is lost.
// It never makes up a quantity: if the note didn't give one, the quantity is left empty.
import type { MaterialItem, MaterialList } from './materialList';

const UNITS = [
  'cubic yards?', 'cu\\.? ?yds?', 'yards?', 'yds?', 'tons?', 'bags?', 'sq\\.? ?ft', 'square feet', 'linear feet', 'lin\\.? ?ft', 'feet', 'foot', 'ft', "'", 'inch(?:es)?', 'in',
  'pallets?', 'rolls?', 'flats?', 'gallons?', 'gal', 'lbs?', 'pounds?', 'pieces?', 'pcs', 'units?', 'each', 'ea', 'loads?', 'yd', 'bales?', 'buckets?', 'boxes', 'box', 'sheets?', 'stakes?', 'blocks?', 'stones?',
];
const UNIT_RE = new RegExp(`(\\d+(?:\\.\\d+)?|\\d+\\s*/\\s*\\d+)\\s*(?:x\\s*)?(${UNITS.join('|')})(?![a-z])`, 'i');
const LEADING_NUM_RE = /^\s*(\d+(?:\.\d+)?)\s+(?!x\b|by\b)/i;

const CATEGORIES: [string, RegExp][] = [
  ['Mulch', /\bmulch\b/i],
  ['Concrete & Masonry', /\b(concrete|cement|mortar|polymeric|rebar|footing)\b/i],
  ['Stone & Gravel', /\b(stone|gravel|rock|boulders?|flagstone|belgian|rip ?rap|crushed|pea gravel|screenings|rubble|stone dust)\b/i],
  ['Pavers & Wall Block', /\b(pavers?|retaining wall|wall block|blocks?|cap stones?|capstone|coping|steps?)\b/i],
  ['Soil & Sand', /\b(top ?soil|soil|compost|dirt|fill|sand|loam|peat)\b/i],
  ['Plants & Trees', /\b(plants?|trees?|shrubs?|flowers?|perennials?|annuals?|bushes|hydrangeas?|boxwoods?|arborvitae|hostas?|ornamental|bulbs?)\b/i],
  ['Lawn', /\b(sod|grass|seed|lawn|straw|turf)\b/i],
  ['Edging', /\b(edging|edge)\b/i],
  ['Fabric & Liner', /\b(fabric|weed barrier|liner|tarp|plastic)\b/i],
  ['Irrigation & Drainage', /\b(pipe|drain|drainage|sprinklers?|irrigation|valve|corrugated|pvc|catch basin|downspout|tile)\b/i],
  ['Fertilizer & Treatments', /\b(fertilizer|lime|pre-?emergent|weed killer|herbicide|pesticide|insecticide|gypsum)\b/i],
  ['Lighting & Electrical', /\b(lights?|lighting|wire|wiring|transformer|fixture)\b/i],
  ['Hardware', /\b(screws?|nails?|spikes?|stakes?|fasteners?|brackets?|anchors?|staples?|adhesive|glue)\b/i],
];

const FILLER = /^(?:i\s+)?(?:need(?:s|ed)?|order|get|buy|pick up|bring|want|use|about|approx\.?|approximately|around|roughly|maybe|total|of|the|some)\b[\s,:-]*/i;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s,;:.\-–•*]+|[\s,;:.\-–]+$/g, '').trim();

/** Splits notes into single lines of thought. Commas split a line only when several parts each start with a number. */
export function splitNotes(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n|;|•|•/)) {
    const l = tidy(line.replace(/^\s*(?:\[[^\]]*\]\s*)?[-*]\s+/, '').replace(/^\s*\[[A-Za-z]{3} \d{1,2}\]\s*/, ''));
    if (!l) continue;
    const parts = l.split(/,(?![^(]*\))/).map(tidy).filter(Boolean);
    const quantified = parts.filter((p) => /^\d/.test(p) || UNIT_RE.test(p)).length;
    if (parts.length > 1 && quantified >= 2) out.push(...parts); else out.push(l);
  }
  return out;
}

function categoryOf(s: string): string | null {
  for (const [name, re] of CATEGORIES) if (re.test(s)) return name;
  return null;
}

/** A line that starts like a to-do ("call Dave", "check the drain") is a reminder, not something to order. */
const REMINDER_RE = /^(?:check|call|ask|remember|confirm|verify|measure|see|note|talk|email|text|schedule|find out|look|make sure|don't forget|dont forget|follow up|photograph|take|send|meet)\b/i;

/** One line into a material item, or null when it isn't a material. */
export function parseLine(line: string): MaterialItem | null {
  if (REMINDER_RE.test(line.trim())) return null;
  let work = line;
  let notes = '';
  const paren = work.match(/\(([^)]*)\)/);
  if (paren) { notes = tidy(paren[1]); work = work.replace(paren[0], ' '); }
  const dash = work.match(/\s[-–]\s(.+)$/);
  if (dash) { notes = [notes, tidy(dash[1])].filter(Boolean).join('; '); work = work.replace(dash[0], ''); }
  const colon = work.match(/^([^:]+):\s*(.+)$/);
  if (colon && !/^\d/.test(colon[2])) { notes = [notes, tidy(colon[2])].filter(Boolean).join('; '); work = colon[1]; }

  const category = categoryOf(work);
  let quantity: number | null = null;
  let unit = '';
  const u = work.match(UNIT_RE);
  if (u) {
    const n = u[1].includes('/') ? (() => { const [a, b] = u[1].split('/').map(Number); return b ? a / b : NaN; })() : Number(u[1]);
    if (Number.isFinite(n)) {
      // "40 x 60 ft" is a measurement of an area, not a quantity to order.
      const isArea = /\d\s*(?:x|by)\s*\d/i.test(work) && !category;
      if (!isArea) { quantity = Math.round(n * 100) / 100; unit = u[2].toLowerCase().replace(/\.$/, ''); work = work.replace(u[0], ' '); }
    }
  }
  if (quantity === null) {
    const lead = work.match(LEADING_NUM_RE);
    if (lead && category) { quantity = Number(lead[1]); work = work.replace(lead[0], ' '); }
  }
  // Not a material: no recognised material word and no quantity with a unit.
  if (!category && quantity === null) return null;

  work = work.replace(/,?\s*\b(?:about|approx\.?|approximately|around|roughly)\b/gi, ' ').replace(/\b(?:more|extra|additional|total|please|asap)\b/gi, ' ');
  let item = tidy(work).replace(FILLER, '');
  item = tidy(item.replace(/^(?:of|the)\s+/i, '').replace(/\b(?:of)\b\s*$/i, ''));
  if (!item) item = category ?? 'Item';
  return { category: category ?? 'Other', item: cap(item), quantity, unit, notes };
}

/** Sorts the notes (as one block of text) into a materials list. */
export function sortNotesLocally(text: string, projectName: string): MaterialList {
  const items: MaterialItem[] = [];
  const other: string[] = [];
  for (const line of splitNotes(text)) {
    const it = parseLine(line);
    if (it) items.push(it); else other.push(cap(line));
  }
  // The same thing written twice is listed once (quantities add up when the unit matches).
  const merged: MaterialItem[] = [];
  for (const it of items) {
    const same = merged.find((m) => m.category === it.category && m.item.toLowerCase() === it.item.toLowerCase() && m.unit === it.unit && m.quantity != null && it.quantity != null);
    if (same) { same.quantity = (same.quantity as number) + (it.quantity as number); if (it.notes && !same.notes.includes(it.notes)) same.notes = [same.notes, it.notes].filter(Boolean).join('; '); }
    else merged.push({ ...it });
  }
  const rank = (c: string) => { const i = CATEGORIES.findIndex(([n]) => n === c); return i < 0 ? 999 : i; };
  merged.sort((a, b) => rank(a.category) - rank(b.category));
  return { title: `${projectName} materials`, items: merged, otherNotes: other };
}
