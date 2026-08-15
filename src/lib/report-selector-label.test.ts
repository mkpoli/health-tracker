import { describe, expect, it } from 'vitest';
import { formatReportSelectorLabel } from './report-selector-label';

describe('formatReportSelectorLabel', () => {
	it('distinguishes reports that share a fallback title', () => {
		const first = formatReportSelectorLabel({
			title: 'Lab report',
			testDate: '2026-08-05T01:00:00.000Z',
			timeZone: 'Asia/Tokyo',
			locale: 'en',
		});
		const second = formatReportSelectorLabel({
			title: 'Lab report',
			testDate: '2026-08-06T01:00:00.000Z',
			timeZone: 'Asia/Tokyo',
			locale: 'en',
		});

		expect(first).toContain('Lab report');
		expect(second).toContain('Lab report');
		expect(first).not.toBe(second);
	});

	it('formats the report instant in its stored timezone', () => {
		const label = formatReportSelectorLabel({
			title: 'Clinic',
			testDate: '2026-08-05T23:30:00.000Z',
			timeZone: 'Asia/Tokyo',
			locale: 'en-CA',
		});

		expect(label).toContain('Aug 6, 2026');
	});
});
