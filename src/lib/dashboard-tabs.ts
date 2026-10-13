export const dashboardTabIds = ['lab', 'body', 'vitals', 'medicine', 'calories'] as const;

export type DashboardTab = (typeof dashboardTabIds)[number];

/** The lab tab is the dashboard root; every other tab has its own path. */
export const defaultDashboardTab: DashboardTab = 'lab';

export function isDashboardTab(value: string): value is DashboardTab {
  return dashboardTabIds.includes(value as DashboardTab);
}

/** The tab a dashboard path segment names, the root naming the lab tab. */
export function dashboardTabOf(segment: string | undefined): DashboardTab {
  return segment && isDashboardTab(segment) ? segment : defaultDashboardTab;
}

/** The path of a tab, carrying the query (the selected profile) along. */
export function dashboardTabHref(tab: DashboardTab, search = '') {
  return `${tab === defaultDashboardTab ? '/' : `/${tab}`}${search}`;
}
