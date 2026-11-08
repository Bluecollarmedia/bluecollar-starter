// Where tapping a notification (in the notification center, or a push) takes the owner. Pure, no network.
// One place, so the in-app list and push taps can never disagree.

const DOC_TYPES = new Set(['quote', 'change_order', 'invoice']);

export interface NotificationLike {
  eventType?: string | null;
  linkedEntityType?: string | null;
  linkedEntityId?: string | null;
}

export type OwnerTarget = string | { pathname: string; params: Record<string, string> };

/**
 * The owner's destination, or null when the notification has no place to open (the caller then just stays on the list,
 * or for a push opens the notification center). A customer message opens that project's Customer > Messages thread
 * directly, never the project Overview.
 */
export function ownerNotificationTarget(n: NotificationLike): OwnerTarget | null {
  const type = n.linkedEntityType ?? '';
  const id = n.linkedEntityId ?? '';
  if (!id) return null;
  if (DOC_TYPES.has(type)) return { pathname: '/(owner)/document', params: { kind: type, id } };
  if (type === 'issue') return { pathname: '/(owner)/issue-detail', params: { id } };
  // A service request from the public Request tab (update 114) opens the list of requests.
  if (type === 'service_request') return '/(owner)/service-requests';
  // Hours & Labor (update 64): open the workday or visit behind the alert; a skip request opens the overview, where it is decided.
  if (type === 'time_workday') return { pathname: '/(owner)/more/labor-day', params: { id } };
  if (type === 'time_visit') return { pathname: '/(owner)/more/labor-visit', params: { id } };
  if (type === 'time_skip') return '/(owner)/more/labor';
  if (type === 'project') {
    if (n.eventType === 'customer_message') return `/(owner)/projects/${id}?section=messages`;
    if (n.eventType === 'customer_request_submitted') return `/(owner)/projects/${id}?section=requests`;
    return `/(owner)/projects/${id}`;
  }
  if (type === 'materials') return `/(owner)/projects/${id}?section=materials`;
  // A truck's maintenance reminder opens that truck.
  if (type === 'truck') return `/(owner)/more/trucks/${id}`;
  // A snow stop alert (update 31) opens the snow dashboard, where the storm's progress lives.
  if (type === 'snow_visit' || type === 'snow_route') return '/snow/owner';
  return null;
}

/** The notification's title for a customer message: names the actual customer. */
export function customerMessageTitle(customerName: string): string {
  return `New message from ${customerName.trim() || 'a customer'}`;
}

/** The notification's text: the project (when there is one) and a short preview of what was said. */
export function customerMessageBody(projectName: string | undefined, text: string): string {
  const preview = text.length > 120 ? `${text.slice(0, 117)}…` : text;
  return projectName ? `${projectName}: ${preview}` : preview;
}
