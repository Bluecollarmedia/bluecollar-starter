/**
 * Real PDF output for quotes, change orders and invoices.
 *
 *  1. The branded HTML (lib/documentHtml.ts) is printed to a Letter-size PDF
 *     by the system print engine (expo-print), so text stays selectable and
 *     the logo is the real image, not a screenshot.
 *  2. pdf-lib stamps the footer and "Page X of Y" onto every page.
 *  3. The file is saved as e.g. Q-1001.pdf and handed to the native share
 *     sheet (Mail, Messages, WhatsApp, Files, Print…).
 *
 * On the web there's no file system, so the browser's print dialog opens
 * instead (choose "Save as PDF").
 */

import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { renderDocumentHtml, footerText, type DocumentHtmlOptions } from './documentHtml';
import type { FinancialDoc, DocumentSnapshot } from '@/types/financial';

/** Letter, in points. */
const PAGE = { width: 612, height: 792 };
/** Matches the CSS margins in documentHtml (0.6in sides/top, 0.85in bottom). */
const IOS_MARGINS = { top: 43, right: 43, bottom: 61, left: 43 };

/** Helvetica in pdf-lib only covers WinAnsi; swap anything else so a stray
 * emoji in a company name can't break the export. */
function winAnsiSafe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E -ÿ]/g, '');
}

/** Adds the footer and page numbers to every page. Exported for tests. */
export async function stampPages(pdf: string | Uint8Array, footer: string, title: string, author: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const size = 7.5;
  const color = rgb(0.54, 0.58, 0.56);
  const left = winAnsiSafe(footer);
  pages.forEach((page, i) => {
    const { width } = page.getSize();
    const label = `Page ${i + 1} of ${pages.length}`;
    page.drawLine({
      start: { x: 43, y: 40 },
      end: { x: width - 43, y: 40 },
      thickness: 0.5,
      color: rgb(0.89, 0.88, 0.85),
    });
    page.drawText(left, { x: 43, y: 27, size, font, color });
    page.drawText(label, { x: width - 43 - font.widthOfTextAtSize(label, size), y: 27, size, font, color });
  });
  doc.setTitle(winAnsiSafe(title));
  doc.setAuthor(winAnsiSafe(author));
  doc.setCreator(winAnsiSafe(author));
  doc.setProducer('Brighton app');
  return doc.save();
}

export interface PdfResult {
  uri: string;
  fileName: string;
  pageCount: number;
}

/** Builds the PDF and saves it to the app's cache folder. */
export async function buildPdf(
  doc: FinancialDoc,
  snapshot: DocumentSnapshot,
  options: Omit<DocumentHtmlOptions, 'mode' | 'nativeMargins'> = {},
): Promise<PdfResult | null> {
  const isIOS = Platform.OS === 'ios';
  const html = renderDocumentHtml(doc, snapshot, { ...options, mode: 'pdf', nativeMargins: isIOS });

  if (Platform.OS === 'web') {
    await Print.printAsync({ html });
    return null;
  }

  const printed = await Print.printToFileAsync({
    html,
    base64: true,
    width: PAGE.width,
    height: PAGE.height,
    ...(isIOS ? { margins: IOS_MARGINS } : {}),
  });
  if (!printed.base64) throw new Error('The PDF could not be created.');

  const label = { quote: 'Quote', change_order: 'Change Order', invoice: 'Invoice' }[doc.kind];
  const bytes = await stampPages(printed.base64, footerText(doc, snapshot), `${label} ${doc.number}`, snapshot.company.name);

  const fileName = `${doc.number.replace(/[^A-Za-z0-9-]/g, '')}.pdf`;
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);

  // The print engine's temporary file isn't needed any more.
  try {
    const tmp = new File(printed.uri);
    if (tmp.exists) tmp.delete();
  } catch {}

  return { uri: file.uri, fileName, pageCount: printed.numberOfPages };
}

/** Opens the native share sheet for a PDF made by buildPdf. */
export async function sharePdf(result: PdfResult, title: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing isn’t available on this device.');
  }
  await Sharing.shareAsync(result.uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: title,
  });
}
