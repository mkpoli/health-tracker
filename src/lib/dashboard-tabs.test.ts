import { describe, expect, it } from 'vitest';
import { dashboardTabHref, dashboardTabOf } from './dashboard-tabs';
import { match } from '../params/dashboardTab';

describe('dashboard tab routes', () => {
  it('gives every tab but the lab its own path', () => {
    expect(dashboardTabHref('lab')).toBe('/');
    expect(dashboardTabHref('medicine', '?patientId=p1')).toBe('/medicine?patientId=p1');
    expect(dashboardTabOf(undefined)).toBe('lab');
    expect(dashboardTabOf('vitals')).toBe('vitals');
  });

  it('matches only the routed tab segments', () => {
    expect(match('calories')).toBe(true);
    expect(match('lab')).toBe(false);
    expect(match('admin')).toBe(false);
  });
});
