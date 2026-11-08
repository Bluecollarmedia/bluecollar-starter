// Maintenance workers get the same Settings as regular workers: profile and
// photo, maps app, notifications, company resources, version and sign out.
// Nothing here is owner-only, so the screen is shared rather than copied.
export { default } from '../(tabs)/settings';
