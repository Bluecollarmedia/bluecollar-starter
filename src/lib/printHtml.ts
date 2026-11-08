/** Prints or shares a page of HTML as a PDF: the system print screen on the web, a shareable PDF file on the phone. */
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

export async function printHtml(html: string, dialogTitle: string): Promise<void> {
  if (Platform.OS === 'web') {
    await Print.printAsync({ html });
    return;
  }
  const { uri } = await Print.printToFileAsync({ html, width: 612, height: 792 });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle });
  else await Print.printAsync({ uri });
}
