import { useCallback, useState } from 'react';
import { buildPdf, sharePdf } from '@/lib/pdf';
import { snapshotFor, templateOptionsFor, DOC_LABEL } from '@/data/financials';
import { showMessage } from '@/components/financials/ActionSheet';
import type { FinancialDoc } from '@/types/financial';

/** Builds a document's PDF and opens the share sheet. */
export function usePdfShare() {
  const [busy, setBusy] = useState(false);

  const share = useCallback(async (doc: FinancialDoc) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await buildPdf(doc, snapshotFor(doc), templateOptionsFor(doc));
      if (result) await sharePdf(result, `${DOC_LABEL[doc.kind]} ${doc.number}`);
    } catch (err) {
      console.warn('[pdf] export failed', err);
      showMessage('PDF not created', (err as Error)?.message || 'Something went wrong making the PDF. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return { share, busy };
}
