import { useCallback, useEffect, useRef } from 'react';

/**
 * A form in a bottom sheet keeps what was typed while its page stays open: swipe the sheet down (or tap Cancel) and open it again, and your
 * text is still there. It starts fresh only the first time it opens, when it is opened for a different item, or after it was saved. Leaving
 * the page throws the draft away, because the sheet goes with the page.
 *
 * `reset` fills the form (blank for a new one, or from the item being edited). Call the returned function when the form is saved.
 */
export function useKeepDraft(visible: boolean, key: string, reset: () => void): () => void {
  const lastKey = useRef<string | null>(null);
  const saved = useRef(false);
  useEffect(() => {
    if (!visible) return;
    if (lastKey.current !== key || saved.current) {
      lastKey.current = key;
      saved.current = false;
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, key]);
  return useCallback(() => { saved.current = true; }, []);
}
