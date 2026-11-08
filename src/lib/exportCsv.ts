import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

/**
 * Saves a CSV (text from toCsv in timeCalc.ts) and hands it to the phone's share sheet, or downloads it in a browser.
 * The file is a real .csv with a UTF-8 byte-order mark, so Excel opens names and numbers correctly.
 */
export async function shareCsv(fileName: string, csv: string): Promise<void> {
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-');
  const name = safe.toLowerCase().endsWith('.csv') ? safe : `${safe}.csv`;
  if (Platform.OS === 'web') {
    const g = globalThis as unknown as { Blob?: typeof Blob; URL?: typeof URL; document?: Document };
    if (!g.Blob || !g.URL || !g.document) throw new Error('Downloads are not available here.');
    const url = g.URL.createObjectURL(new g.Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = g.document.createElement('a');
    a.href = url;
    a.download = name;
    g.document.body.appendChild(a);
    a.click();
    a.remove();
    g.URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(csv);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing isn’t available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: name });
}
