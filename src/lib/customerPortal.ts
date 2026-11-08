/**
 * What a customer's portal shows depends on what they actually have: landscaping
 * projects and maintenance properties. Each service shows only when
 * the customer is really linked to it, and the "nothing yet" message only appears
 * when they have none of them. Pure helpers.
 */

export interface PortalHas {
  projects: number;
  maintenance: number;
}

export interface PortalSections {
  showProjects: boolean;
  showMaintenance: boolean;
  /** Nothing at all is linked to this customer yet. */
  showEmpty: boolean;
}

export function portalSections(has: PortalHas): PortalSections {
  const showProjects = has.projects > 0;
  const showMaintenance = has.maintenance > 0;
  return { showProjects, showMaintenance, showEmpty: !showProjects && !showMaintenance };
}

/** Words for the empty state: it never claims "no projects" when the customer has another service. */
export function emptyPortalText(): { title: string; description: string } {
  return {
    title: 'Nothing here yet',
    description: 'Your landscaping projects and maintenance visits appear here once your landscaper links them to your account.',
  };
}
