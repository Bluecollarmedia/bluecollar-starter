/**
 * Dialogs on the website. On a phone, Alert.alert is the system dialog. On the website, React Native's Alert.alert does nothing at all,
 * and the browser's own confirm()/alert() can be blocked or suppressed (Safari asks "prevent this page from creating more dialogs").
 * So on the website every dialog is drawn by the app itself (WebDialogHost), and Alert.alert is pointed at it once at startup.
 */
import { Alert, Platform } from 'react-native';

export interface DialogButton { text?: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: (value?: any) => void }
export interface DialogRequest { title: string; message?: string; buttons: DialogButton[] }

type Listener = (queue: DialogRequest[]) => void;
let queue: DialogRequest[] = [];
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l(queue));

export function subscribeDialogs(l: Listener): () => void {
  listeners.add(l);
  l(queue);
  return () => { listeners.delete(l); };
}

/** Shows a dialog (website). Buttons default to a single OK. */
export function showWebDialog(title: string, message?: string, buttons?: DialogButton[]) {
  queue = [...queue, { title, message, buttons: buttons && buttons.length ? buttons : [{ text: 'OK' }] }];
  emit();
}

/** Closes the dialog on screen, then runs the button's action. */
export function answerWebDialog(button: DialogButton) {
  queue = queue.slice(1);
  emit();
  button.onPress?.();
}

let installed = false;
/** The website: Alert.alert opens the app's own dialog instead of doing nothing. A phone keeps the system Alert. */
export function installWebAlert() {
  if (installed || Platform.OS !== 'web') return;
  installed = true;
  Alert.alert = ((title: string, message?: string, buttons?: DialogButton[]) => showWebDialog(title, message, buttons)) as typeof Alert.alert;
}
