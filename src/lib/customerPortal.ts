/**
 * What a customer's portal shows depends on what they actually have: landscaping
 * projects, maintenance properties, snow properties. Each service shows only when
 * the customer is really linked to it, and the "nothing yet" message only appears
 * when they have none of them. Pure helpers.
 */

export interface PortalHas {
  projects: number;
  maintenance: number;
  snow: number;
}

export interface PortalSections {
  showProjects: boolean;
  showMaintenance: boolean;
  showSnow: boolean;
  /** Nothing at all is linked to this customer yet. */
  showEmpty: boolean;
}

export function portalSections(has: PortalHas): PortalSections {
  const showProjects = has.projects > 0;
  const showMaintenance = has.maintenance > 0;
  const showSnow = has.snow > 0;
  return { showProjects, showMaintenance, showSnow, showEmpty: !showProjects && !showMaintenance && !showSnow };
}

/** Words for the empty state: it never claims "no projects" when the customer has another service. */
export function emptyPortalText(): { title: string; description: string } {
  return {
    title: 'Nothing here yet',
    description: 'Your landscaping projects, maintenance visits and snow updates appear here once your landscaper links them to your account.',
  };
}

/** The line under a snow property on the Home card. */
export function snowCardSubtitle(address?: string): string {
  return `${address ? `${address} · ` : ''}Plowing, shoveling and salting updates`;
}
