import { normalizeTimeZone } from './time-zone';

export function formatReportSelectorLabel({
	title,
	testDate,
	timeZone,
	locale,
}: {
	title: string;
	testDate: string;
	timeZone: string;
	locale: string;
}) {
	const parsed = new Date(testDate);
	if (Number.isNaN(parsed.getTime())) return `${title} · ${testDate}`;

	const date = new Intl.DateTimeFormat(locale, {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: normalizeTimeZone(timeZone),
	}).format(parsed);
	return `${title} · ${date}`;
}
