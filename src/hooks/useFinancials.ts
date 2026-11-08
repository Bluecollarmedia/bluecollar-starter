import { useMemo } from 'react';
import { db, useDb } from '@/data/store';
import { allDocs, getDoc, projectSummary, eventsFor } from '@/data/financials';
import type { FinancialDocType } from '@/types/financial';

/** Every quote, change order and invoice (or one project's), newest first. */
export function useFinancialDocs(projectId?: string) {
  const v = useDb();
  return useMemo(() => allDocs(projectId), [projectId, v]);
}

export function useFinancialDoc(kind: FinancialDocType | undefined, id: string | undefined) {
  const v = useDb();
  const doc = useMemo(() => (kind && id ? getDoc(kind, id) : null), [kind, id, v]);
  const events = useMemo(() => (id ? eventsFor(id) : []), [id, v]);
  const project = useMemo(() => (doc ? db.projects.find((p) => p.id === doc.projectId) ?? null : null), [doc, v]);
  const linkedQuote = useMemo(
    () => (doc && doc.kind !== 'quote' && doc.quoteId ? db.quotes.find((q) => q.id === doc.quoteId) ?? null : null),
    [doc, v],
  );
  const includedChangeOrders = useMemo(
    () => (doc?.kind === 'invoice' ? db.changeOrders.filter((c) => doc.changeOrderIds.includes(c.id)) : []),
    [doc, v],
  );
  return { doc, events, project, linkedQuote, includedChangeOrders, ready: db.ready };
}

export function useProjectFinancialSummary(projectId: string) {
  const v = useDb();
  return useMemo(() => projectSummary(projectId), [projectId, v]);
}
