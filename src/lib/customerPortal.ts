/**
 * What a customer's portal says when nothing is linked to them yet. Pure helper.
 */

/** Words for the empty state: shown only when the customer has no jobs yet (t() puts in the settings words). */
export function emptyPortalText(): { title: string; description: string } {
  return {
    title: 'Nothing here yet',
    description: 'Your jobs appear here once your contractor links them to your account.',
  };
}
