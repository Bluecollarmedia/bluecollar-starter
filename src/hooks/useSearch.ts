import { useMemo } from 'react';
import { db, useDb } from '@/data/store';

export interface SearchResult {
  id: string;
  type: 'project' | 'worker' | 'customer';
  title: string;
  subtitle: string;
  icon: string;
}

// Small in-house Levenshtein distance — no need to pull in a fuzzy-search
// dependency just for this. Used to tolerate typos/misspellings like
// "beachwod" -> "Beachwood" or "marcs" -> "Marcus".
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Score one field's value against the query: higher is a stronger match, 0 is no match. */
function scoreField(value: string | undefined | null, query: string): number {
  if (!value) return 0;
  const v = value.toLowerCase().trim();
  const q = query.toLowerCase().trim();
  if (!v || !q) return 0;

  if (v === q) return 100;
  if (v.startsWith(q)) return 90;
  if (v.includes(q)) return 75;

  const words = v.split(/[\s,.\-()]+/).filter(Boolean);
  let best = 0;
  for (const w of words) {
    if (w.startsWith(q)) {
      best = Math.max(best, 65);
      continue;
    }
    const dist = levenshtein(q, w);
    const threshold = q.length <= 4 ? 1 : q.length <= 7 ? 2 : 3;
    if (dist <= threshold) {
      best = Math.max(best, 60 - dist * 12);
    }
  }
  return best;
}

export function useSearch(query: string) {
  const v = useDb();
  const results = useMemo<SearchResult[]>(() => {
    if (!query.trim() || query.length < 2) return [];

    const scored: (SearchResult & { score: number })[] = [];

    for (const p of db.projects) {
      const customerName = p.customer ? `${p.customer.firstName} ${p.customer.lastName}` : '';
      const score = Math.max(
        scoreField(p.name, query),
        scoreField(customerName, query) * 0.9,
        scoreField(p.address, query) * 0.7,
        scoreField(p.city, query) * 0.7,
      );
      if (score > 0) {
        scored.push({
          id: p.id,
          type: 'project',
          title: p.name,
          subtitle: `${p.status} · ${p.address ?? ''}`,
          icon: 'folder',
          score,
        });
      }
    }

    for (const m of db.members) {
      if (!m.person) continue;
      const p = m.person;
      const name = `${p.firstName} ${p.lastName}`;
      const score = Math.max(
        scoreField(name, query),
        scoreField(p.email, query) * 0.8,
        scoreField(p.phone, query) * 0.8,
      );
      if (score > 0) {
        if (m.role === 'worker') {
          scored.push({ id: p.id, type: 'worker', title: name, subtitle: `Worker · ${p.email}`, icon: 'users', score });
        } else if (m.role === 'customer') {
          scored.push({ id: p.id, type: 'customer', title: name, subtitle: `Customer · ${p.email}`, icon: 'user', score });
        }
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.map(({ score, ...item }) => item);
  }, [query, v]);

  return { results };
}
