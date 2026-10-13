import type { ParamMatcher } from '@sveltejs/kit';
import { defaultDashboardTab, isDashboardTab } from '$lib/dashboard-tabs';

// The lab tab lives at the root, so `/lab` is not a second address for it.
export const match: ParamMatcher = (param) => isDashboardTab(param) && param !== defaultDashboardTab;
