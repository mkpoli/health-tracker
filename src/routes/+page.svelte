<script lang="ts">
  import { enhance } from '$app/forms';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime';
  import { tick } from 'svelte';
  import { normalizeComparableMeasurement } from '$lib/metrics/normalization';
  import WikipediaIcon from '~icons/simple-icons/wikipedia';
  import WikidataIcon from '~icons/simple-icons/wikidata';
  import {
    getCalculatedMetricDefinitions,
    getMetricDefinition,
    getMetricMessageKey,
    getMetricTags,
    getMetricWikipediaFallbackUrl,
    getMetricWikipediaUrl,
    getMetricWikidataUrl,
    metricSuggestions,
  } from '$lib/metrics/catalog';

  import WelcomeWizard from '$lib/components/WelcomeWizard.svelte';
  import AddPatientModal from '$lib/components/AddPatientModal.svelte';
  import DangerZoneModal from '$lib/components/DangerZoneModal.svelte';
  import LanguageSwitcher from '$lib/components/LanguageSwitcher.svelte';

  let { data, form } = $props();

  let recordType = $state('blood_pressure');
  let valuePlaceholder = $state('120/80');
  let valueLabel = $state(m.reading_label());

  let isExtracting = $state(false);
  let isSavingReport = $state(false);
  let extractText = $state('');
  let extractFile: File | null = $state(null);
  let homepageExtractFile: File | null = $state(null);
  let homepageExtractSubmitting = $state(false);
  let fileInput: HTMLInputElement = $state() as HTMLInputElement;
  let smartUploadActive = $state(true);

  let showPatientModal = $state(false);
  let showDeleteModal = $state(false);

  let selectedRecordIds = $state<string[]>([]);
  let selectedTrendMetric = $state('');
  let trendSearchQuery = $state('');
  let trendComboboxOpen = $state(false);
  let lastSyncedTrendMetric = $state('');
  let reportFacilityName = $state('');
  let reportTestDate = $state('');
  let reportRawSource = $state('');
  let reviewTargetReportId = $state<ReportDestination>('new');
  let expandedReportIds = $state<string[]>([]);
  let trendComboboxContainer = $state<HTMLDivElement | null>(null);
  let trendOptionButtons = $state<Record<string, HTMLButtonElement | null>>({});

  const currentLocale = $derived(getLocale());

  type TrendPoint = {
    id: string;
    metricName: string;
    value: number;
    rawValue: string;
    unit: string | null;
    rawUnit: string | null;
    status: string | null;
    date: string | null;
    chartDate: string;
    formattedDate: string;
    refRange: string | null;
    rawRefRange: string | null;
    reportId: string | null;
    calculated: boolean;
  };

  type ParsedRefRange = {
    low: number | null;
    high: number | null;
    label: string;
  };

  type ReviewMetric = {
    type: string;
    originalLabel: string;
    parsedLabel: string;
    value: string | number;
    unit?: string | null;
    comparableValue?: string | number | null;
    comparableUnit?: string | null;
    comparableReferenceRange?: string | null;
    referenceRange?: string | null;
    date?: string | null;
    status?: string | null;
    notes?: string | null;
    saveMode: 'create' | 'update';
    matchedRecordId: string | null;
  };

  type ReportDestination = 'new' | string;

  type RawReportSource = {
    kind: 'text' | 'file';
    text?: string;
    dataUrl?: string;
    mimeType?: string | null;
    fileName?: string | null;
  };

  type TrendMetricGroup = {
    metricName: string;
    points: TrendPoint[];
  };

  type TrendMetricOption = {
    metricName: string;
    label: string;
    testType: string;
    testTypeLabel: string;
    categoryKeys: string[];
    categoryLabels: string[];
    primaryGroupKey: string;
    primaryGroupLabel: string;
    secondaryGroupKey: string;
    secondaryGroupLabel: string;
    readingCount: number;
    searchText: string;
  };

  const reportLookup = $derived(
    Object.fromEntries(data.reports.map((report) => [report.id, report])),
  );

  const recordLookup = $derived(
    Object.fromEntries(data.records.map((record) => [record.id, record])),
  );

  const reportCounts = $derived.by(() => {
    const counts: Record<string, number> = {};

    for (const item of data.records) {
      counts[item.reportId] = (counts[item.reportId] || 0) + 1;
    }

    return counts;
  });

  const reportFacilities = $derived.by(() => {
    const facilities: Record<string, string> = {};

    for (const item of data.reports) {
      facilities[item.id] = getReportFacility(item);
    }

    return facilities;
  });

  const reportNotes = $derived.by(() => {
    const notes: Record<string, string> = {};

    for (const item of data.reports) {
      notes[item.id] = getReportNotes(item);
    }

    return notes;
  });

  const groupedReports = $derived.by(() =>
    data.reports.map((report) => ({
      report,
      title: getReportTitle(report),
      facilityName: reportFacilities[report.id],
      notes: reportNotes[report.id],
      records: data.records.filter((record) => record.reportId === report.id),
    })),
  );

  const trendMetrics = $derived.by(() => {
    const grouped = new Map<string, TrendPoint[]>();
    const reportMetricValues = new Map<string, Map<string, { point: TrendPoint; value: number }>>();

    for (const item of data.records) {
      const numericValue = getRecordComparableValue(item);

      if (numericValue === null) continue;

      const report = reportLookup[item.reportId];
      const point: TrendPoint = {
        id: item.id,
        metricName: item.metricName,
        value: numericValue,
        rawValue: item.value,
        unit: getRecordComparableUnit(item),
        rawUnit: item.unit,
        status: item.status,
        date: report?.testDate || null,
        chartDate: formatDate(report?.testDate || null, { dateStyle: 'medium' }),
        formattedDate: formatDate(report?.testDate || null),
        refRange: getRecordComparableRange(item),
        rawRefRange: item.refRange,
        reportId: item.reportId,
        calculated: false,
      };

      const existing = grouped.get(item.metricName) || [];
      existing.push(point);
      grouped.set(item.metricName, existing);

      const definition = getMetricDefinition(item.metricName);
      const reportValues = reportMetricValues.get(item.reportId) || new Map();
      reportValues.set(definition.key, { point, value: numericValue });
      reportMetricValues.set(item.reportId, reportValues);
    }

    for (const calculatedDefinition of getCalculatedMetricDefinitions()) {
      const calculation = calculatedDefinition.calculation;
      if (!calculation) continue;

      for (const report of data.reports) {
        const reportValues = reportMetricValues.get(report.id);
        if (!reportValues || reportValues.has(calculatedDefinition.key)) continue;

        const dependencyInputs: Record<string, number> = {};
        let missingDependency = false;

        for (const dependency of calculation.dependencies) {
          const dependencyValue = reportValues.get(dependency);
          if (!dependencyValue) {
            missingDependency = true;
            break;
          }

          dependencyInputs[dependency] = dependencyValue.value;
        }

        if (missingDependency) continue;

        const computedValue = calculation.compute(dependencyInputs);
        if (computedValue === null || !Number.isFinite(computedValue)) continue;

        const precision = calculation.precision ?? 2;
        const roundedValue = Number(computedValue.toFixed(precision));
        const calculatedPoint: TrendPoint = {
          id: `calculated:${report.id}:${calculatedDefinition.key}`,
          metricName: calculatedDefinition.canonicalLabel,
          value: roundedValue,
          rawValue: roundedValue.toFixed(precision),
          unit: calculation.unit ?? null,
          rawUnit: calculation.unit ?? null,
          status: null,
          date: report.testDate || null,
          chartDate: formatDate(report.testDate || null, { dateStyle: 'medium' }),
          formattedDate: formatDate(report.testDate || null),
          refRange: null,
          rawRefRange: null,
          reportId: report.id,
          calculated: true,
        };

        const existing = grouped.get(calculatedDefinition.canonicalLabel) || [];
        existing.push(calculatedPoint);
        grouped.set(calculatedDefinition.canonicalLabel, existing);
      }
    }

    return Array.from(grouped.entries())
      .map(([metricName, points]) => ({
        metricName,
        points: points.sort((a, b) => {
          const aTime = a.date ? new Date(a.date).getTime() : 0;
          const bTime = b.date ? new Date(b.date).getTime() : 0;
          return aTime - bTime;
        }),
      }))
      .filter(({ points }) => points.length > 0)
      .sort((a, b) => b.points.length - a.points.length || a.metricName.localeCompare(b.metricName));
  });

  const selectedTrend = $derived(
    trendMetrics.find(({ metricName }) => metricName === selectedTrendMetric) || trendMetrics[0],
  );

  const selectedTrendDefinition = $derived(getMetricDefinition(selectedTrend?.metricName));
  const selectedTrendLabel = $derived(getMetricLabel(selectedTrend?.metricName));
  const selectedTrendTags = $derived(getMetricTags(selectedTrendDefinition));
  const selectedTrendWikidataUrl = $derived(getMetricWikidataUrl(selectedTrendDefinition));
  const selectedTrendWikipediaUrl = $derived(getMetricWikipediaUrl(selectedTrendDefinition, currentLocale));
  const selectedTrendWikipediaFallbackUrl = $derived(getMetricWikipediaFallbackUrl(selectedTrendDefinition));

  const groupedTrendMetrics = $derived.by(() => {
    const groups = new Map<string, { key: string; label: string; metrics: TrendMetricGroup[] }>();

    for (const metric of trendMetrics) {
      const definition = getMetricDefinition(metric.metricName);
      const tags = getMetricTags(definition);
      const primaryCategory = tags.categories[0] || 'other';
      const groupKey = primaryCategory;
      const existing = groups.get(groupKey) || {
        key: groupKey,
        label: getCategoryLabel(groupKey),
        metrics: [] as TrendMetricGroup[],
      };

      existing.metrics.push(metric);
      groups.set(groupKey, existing);
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        metrics: group.metrics.sort((a, b) => getMetricLabel(a.metricName).localeCompare(getMetricLabel(b.metricName))),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  const trendMetricOptions = $derived.by(() =>
    trendMetrics.map((metric) => {
      const definition = getMetricDefinition(metric.metricName);
      const tags = getMetricTags(definition);
      const categoryKeys = tags.categories.length ? tags.categories : ['other'];
      const categoryLabels = categoryKeys.map(getCategoryLabel);

      return {
        metricName: metric.metricName,
        label: getMetricLabel(metric.metricName),
        testType: tags.testType,
        testTypeLabel: getTestTypeLabel(tags.testType),
        categoryKeys,
        categoryLabels,
        primaryGroupKey: categoryKeys[0] || 'other',
        primaryGroupLabel: categoryLabels[0] || getCategoryLabel('other'),
        secondaryGroupKey: categoryKeys[1] || 'general',
        secondaryGroupLabel: categoryLabels[1] || 'General',
        readingCount: metric.points.length,
        searchText: [
          metric.metricName,
          getMetricLabel(metric.metricName),
          definition.canonicalLabel,
          ...(definition.aliases || []),
          tags.testType,
          ...categoryKeys,
          ...categoryLabels,
        ]
          .map((value) => normalizeMetricMatchKey(value))
          .filter(Boolean)
          .join(' '),
      } satisfies TrendMetricOption;
    }),
  );

  const filteredTrendMetricOptions = $derived.by(() => {
    const query = normalizeMetricMatchKey(trendSearchQuery);
    const selectedLabelQuery = normalizeMetricMatchKey(selectedTrendMetric ? getMetricLabel(selectedTrendMetric) : '');

    if (!query || query === selectedLabelQuery) return trendMetricOptions;

    return trendMetricOptions.filter((option) => option.searchText.includes(query));
  });

  const groupedTrendMetricOptions = $derived.by(() => {
    const groups = new Map<
      string,
      { key: string; label: string; sections: Map<string, { key: string; label: string; options: TrendMetricOption[] }> }
    >();

    for (const option of filteredTrendMetricOptions) {
      const group = groups.get(option.primaryGroupKey) || {
        key: option.primaryGroupKey,
        label: option.primaryGroupLabel,
        sections: new Map(),
      };
      const section = group.sections.get(option.secondaryGroupKey) || {
        key: option.secondaryGroupKey,
        label: option.secondaryGroupLabel,
        options: [],
      };

      section.options.push(option);
      group.sections.set(option.secondaryGroupKey, section);
      groups.set(option.primaryGroupKey, group);
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        sections: Array.from(group.sections.values())
          .map((section) => ({
            ...section,
            options: section.options.sort((a, b) => a.label.localeCompare(b.label)),
          }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  const trendChart = $derived.by(() => {
    const series = selectedTrend?.points || [];

    if (series.length === 0) {
      return null;
    }

    const parsedRanges = series.map((point) => parseReferenceRange(point.refRange)).filter(Boolean) as ParsedRefRange[];
    const values = series.map((point) => point.value);

    for (const range of parsedRanges) {
      if (range.low !== null) values.push(range.low);
      if (range.high !== null) values.push(range.high);
    }

    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const spread = rawMax - rawMin || Math.max(Math.abs(rawMax) * 0.1, 1);
    const min = rawMin - spread * 0.18;
    const max = rawMax + spread * 0.18;
    const width = 640;
    const height = 220;
    const left = 20;
    const right = 20;
    const top = 14;
    const bottom = 36;
    const chartWidth = width - left - right;
    const chartHeight = height - top - bottom;
    const xStep = series.length > 1 ? chartWidth / (series.length - 1) : 0;

    const xForIndex = (index: number) => left + index * xStep;
    const yForValue = (value: number) => top + ((max - value) / (max - min || 1)) * chartHeight;

    const line = series.map((point, index) => `${xForIndex(index)},${yForValue(point.value)}`).join(' ');
    const area = `${line} ${xForIndex(series.length - 1)},${height - bottom} ${xForIndex(0)},${height - bottom}`;

    const latest = series[series.length - 1];
    const previous = series.length > 1 ? series[series.length - 2] : null;
    const delta = previous ? latest.value - previous.value : null;
    const latestRange =
      parseReferenceRange(latest.refRange) ||
      parsedRanges.find((range) => range.low !== null || range.high !== null) ||
      null;
    const latestDisplayStatus = getStatusFromRange(latest.value, latestRange, latest.status);

    let refRangePath = '';

    if (latestRange && latestRange.low !== null && latestRange.high !== null) {
      const low = latestRange.low;
      const high = latestRange.high;
      const upper = `${left},${yForValue(high)} ${width - right},${yForValue(high)}`;
      const lower = `${width - right},${yForValue(low)} ${left},${yForValue(low)}`;
      refRangePath = `${upper} ${lower}`;
    }

    return {
      width,
      height,
      line,
      area,
      points: series.map((point, index) => ({
        ...point,
        x: xForIndex(index),
        y: yForValue(point.value),
      })),
      firstDate: series[0].formattedDate,
      lastDate: latest.formattedDate,
      latest,
      latestDisplayStatus,
      delta,
      refRange: latestRange,
      refRangePath,
    };
  });

  let allRecordsSelected = $derived(
    data.records.length > 0 && selectedRecordIds.length === data.records.length,
  );

  function toggleSelectAll() {
    if (allRecordsSelected) {
      selectedRecordIds = [];
    } else {
      selectedRecordIds = data.records.map((r) => r.id);
    }
  }

  function toggleReportExpanded(reportId: string) {
    if (expandedReportIds.includes(reportId)) {
      expandedReportIds = expandedReportIds.filter((id) => id !== reportId);
    } else {
      expandedReportIds = [...expandedReportIds, reportId];
    }
  }

  function isReportExpanded(reportId: string) {
    return expandedReportIds.includes(reportId);
  }

  function allReportRecordsSelected(reportId: string) {
    const reportRecords = data.records.filter((record) => record.reportId === reportId).map((record) => record.id);
    return reportRecords.length > 0 && reportRecords.every((id) => selectedRecordIds.includes(id));
  }

  function toggleSelectReport(reportId: string) {
    const reportRecordIds = data.records.filter((record) => record.reportId === reportId).map((record) => record.id);

    if (!reportRecordIds.length) return;

    if (allReportRecordsSelected(reportId)) {
      selectedRecordIds = selectedRecordIds.filter((id) => !reportRecordIds.includes(id));
      return;
    }

    selectedRecordIds = Array.from(new Set([...selectedRecordIds, ...reportRecordIds]));
  }

  function parseNumericValue(value?: string | null) {
    if (!value) return null;

    const normalized = value.trim().replace(/,/g, '');
    if (!/^[-+]?\d*\.?\d+$/.test(normalized)) return null;

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseReferenceRange(refRange?: string | null): ParsedRefRange | null {
    if (!refRange) return null;

    const matches = Array.from(refRange.matchAll(/-?\d*\.?\d+/g), (match) => Number(match[0])).filter(
      (value) => Number.isFinite(value),
    );

    if (matches.length >= 2) {
      const [first, second] = matches;
      return {
        low: Math.min(first, second),
        high: Math.max(first, second),
        label: refRange,
      };
    }

    if (matches.length === 1) {
      const value = matches[0];

      if (refRange.includes('<')) {
        return { low: null, high: value, label: refRange };
      }

      if (refRange.includes('>')) {
        return { low: value, high: null, label: refRange };
      }
    }

    return null;
  }

  function formatDate(
    value?: string | null,
    options: Intl.DateTimeFormatOptions = {
      dateStyle: 'medium',
      timeStyle: 'short',
    },
  ) {
    if (!value) return m.date_unavailable();

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;

    const resolvedOptions = {
      ...options,
      timeStyle: value.includes('T') ? options.timeStyle : undefined,
    } satisfies Intl.DateTimeFormatOptions;

    return new Intl.DateTimeFormat(currentLocale, resolvedOptions).format(parsed);
  }

  function parseJsonLike(value: unknown) {
    if (!value) return null;
    if (typeof value === 'object') return value as Record<string, unknown>;

    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as Record<string, unknown>;
      } catch {
        return null;
      }
    }

    return null;
  }

  function getReportFacility(report: (typeof data.reports)[number]) {
    const extraData = parseJsonLike(report.extraData);
    const organizedData = parseJsonLike(report.organizedData);

    const possibleValues = [
      extraData?.facilityName,
      extraData?.hospital,
      extraData?.lab,
      extraData?.clinic,
      organizedData?.facilityName,
      organizedData?.hospital,
      organizedData?.lab,
      organizedData?.clinic,
    ];

    for (const value of possibleValues) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    return '';
  }

  function getReportNotes(report: (typeof data.reports)[number]) {
    const extraData = parseJsonLike(report.extraData);
    const organizedData = parseJsonLike(report.organizedData);

    const possibleValues = [extraData?.notes, organizedData?.notes, organizedData?.comment, organizedData?.label];

    for (const value of possibleValues) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    return '';
  }

  function getReportTitle(report: (typeof data.reports)[number]) {
    const extraData = parseJsonLike(report.extraData);
    const title = typeof extraData?.title === 'string' ? extraData.title.trim() : '';

    if (title) return title;

    const facility = getReportFacility(report) || m.report_fallback();
    return `${facility} ${formatDate(report.testDate, { dateStyle: 'medium' })}`;
  }

  function getRecordMetadata(record: (typeof data.records)[number]) {
    return parseJsonLike(record.extraData) || {};
  }

  function getRecordComparableValue(record: (typeof data.records)[number]) {
    const metadata = getRecordMetadata(record);
    const candidate = metadata.comparableValue;

    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === 'string' && candidate.trim()) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }

    return normalizeComparableMeasurement(record.value, record.unit, record.refRange).comparableValue;
  }

  function getRecordComparableUnit(record: (typeof data.records)[number]) {
    const metadata = getRecordMetadata(record);
    const candidate = typeof metadata.comparableUnit === 'string' ? metadata.comparableUnit.trim() : '';
    return candidate || normalizeComparableMeasurement(record.value, record.unit, record.refRange).comparableUnit;
  }

  function getRecordComparableRange(record: (typeof data.records)[number]) {
    const metadata = getRecordMetadata(record);
    const candidate = typeof metadata.comparableReferenceRange === 'string' ? metadata.comparableReferenceRange.trim() : '';
    return candidate || normalizeComparableMeasurement(record.value, record.unit, record.refRange).comparableReferenceRange;
  }

  function getRecordOriginalLabel(record: (typeof data.records)[number]) {
    const metadata = getRecordMetadata(record);
    const originalLabel = typeof metadata.originalLabel === 'string' ? metadata.originalLabel.trim() : '';
    return originalLabel && originalLabel !== record.metricName ? originalLabel : '';
  }

  function normalizeMetricMatchKey(value: unknown) {
    if (typeof value !== 'string') return '';

    return value
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getDateOnlyKey(value?: string | null) {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
  }

  function getRecordMatchKeys(record: (typeof data.records)[number]) {
    const metadata = getRecordMetadata(record);

    return [record.metricName, metadata.parsedLabel, metadata.originalLabel]
      .map(normalizeMetricMatchKey)
      .filter(Boolean);
  }

  function getRecordTimestamp(record: (typeof data.records)[number]) {
    const reportDate = reportLookup[record.reportId]?.testDate;
    if (!reportDate) return 0;

    const parsed = new Date(reportDate);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
  }

  function findBestRecordMatch(metric: Omit<ReviewMetric, 'saveMode' | 'matchedRecordId'>, extractedReportDate?: string) {
    const metricKeys = [metric.parsedLabel, metric.originalLabel, metric.type]
      .map(normalizeMetricMatchKey)
      .filter(Boolean);

    if (metricKeys.length === 0) return null;

    const extractedDateKey = getDateOnlyKey(extractedReportDate || metric.date);

    return data.records
      .filter((record) => metricKeys.some((key) => getRecordMatchKeys(record).includes(key)))
      .sort((a, b) => {
        const aDateKey = getDateOnlyKey(reportLookup[a.reportId]?.testDate);
        const bDateKey = getDateOnlyKey(reportLookup[b.reportId]?.testDate);
        const aSameDay = extractedDateKey && aDateKey === extractedDateKey ? 1 : 0;
        const bSameDay = extractedDateKey && bDateKey === extractedDateKey ? 1 : 0;

        return bSameDay - aSameDay || getRecordTimestamp(b) - getRecordTimestamp(a);
      })[0] || null;
  }

  function getMatchedRecord(metric: ReviewMetric) {
    return metric.matchedRecordId ? recordLookup[metric.matchedRecordId] : null;
  }

  function getReviewTargetReport() {
    return reviewTargetReportId === 'new' ? null : reportLookup[reviewTargetReportId] || null;
  }

  function parseRawReportSource(value: unknown): RawReportSource | null {
    const parsed = parseJsonLike(value);
    if (!parsed) return null;

    const kind = parsed.kind;
    if (kind !== 'text' && kind !== 'file') return null;

    return {
      kind,
      text: typeof parsed.text === 'string' ? parsed.text : undefined,
      dataUrl: typeof parsed.dataUrl === 'string' ? parsed.dataUrl : undefined,
      mimeType: typeof parsed.mimeType === 'string' ? parsed.mimeType : null,
      fileName: typeof parsed.fileName === 'string' ? parsed.fileName : null,
    };
  }

  function applyReportSource(source: RawReportSource | null) {
    if (previewFileURL?.startsWith('blob:')) {
      URL.revokeObjectURL(previewFileURL);
    }

    previewFileURL = null;
    previewFileType = null;
    extractText = '';

    if (!source) return;

    if (source.kind === 'text') {
      extractText = source.text || '';
      return;
    }

    if (source.dataUrl) {
      previewFileURL = source.dataUrl;
      previewFileType = source.mimeType || null;
    }
  }

  function fileToDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  async function buildCurrentRawSource() {
    if (extractFile) {
      const dataUrl = await fileToDataUrl(extractFile);

      return JSON.stringify({
        kind: 'file',
        dataUrl,
        mimeType: extractFile.type || null,
        fileName: extractFile.name || null,
      } satisfies RawReportSource);
    }

    if (extractText.trim()) {
      return JSON.stringify({
        kind: 'text',
        text: extractText,
      } satisfies RawReportSource);
    }

    return '';
  }

  function startReportReview(group: (typeof groupedReports)[number]) {
    pendingMetrics = group.records.map((record) => {
      const metadata = getRecordMetadata(record);
      const comparableValue =
        typeof metadata.comparableValue === 'number' || typeof metadata.comparableValue === 'string'
          ? metadata.comparableValue
          : '';

      return {
        type: typeof metadata.category === 'string' ? metadata.category : 'Other',
        originalLabel: getRecordOriginalLabel(record) || record.metricName,
        parsedLabel: typeof metadata.parsedLabel === 'string' ? metadata.parsedLabel : record.metricName,
        value: record.value,
        unit: record.unit || '',
        comparableValue,
        comparableUnit: typeof metadata.comparableUnit === 'string' ? metadata.comparableUnit : record.unit || '',
        comparableReferenceRange:
          typeof metadata.comparableReferenceRange === 'string'
            ? metadata.comparableReferenceRange
            : record.refRange || '',
        referenceRange: record.refRange || '',
        date: group.report.testDate,
        status: record.status || 'Review Required',
        notes: typeof metadata.notes === 'string' ? metadata.notes : '',
        saveMode: 'update',
        matchedRecordId: record.id,
      } satisfies ReviewMetric;
    });

    reportFacilityName = group.facilityName || '';
    reportTestDate = normalizeDateTimeLocal(group.report.testDate);
    reportRawSource = typeof group.report.rawData === 'string' ? group.report.rawData : '';
    reviewTargetReportId = group.report.id;
    applyReportSource(parseRawReportSource(group.report.rawData));
  }

  function getMetricMessage(messageKey: string) {
    const lookup = m as unknown as Record<string, (inputs?: Record<string, never>) => string>;
    const message = lookup[messageKey];
    return typeof message === 'function' ? message({}) : '';
  }

  function getCategoryLabel(category: string) {
    return getMetricMessage(`metric_category_${category.replace(/-/g, '_')}`) || category;
  }

  function getTestTypeLabel(testType: string) {
    return getMetricMessage(`metric_test_type_${testType.replace(/-/g, '_')}`) || testType;
  }

  function getMetricLabel(label?: string | null) {
    const definition = getMetricDefinition(label);
    const localized = getMetricMessage(getMetricMessageKey(definition, 'label'));
    return localized || definition.canonicalLabel;
  }

  function getMetricDescription(label?: string | null) {
    const definition = getMetricDefinition(label);
    const localized = getMetricMessage(getMetricMessageKey(definition, 'description'));
    return localized || m.custom_metric_description();
  }

  function getStatusLabel(status?: string | null) {
    if (status === 'High') return m.status_high();
    if (status === 'Low') return m.status_low();
    if (status === 'Normal') return m.status_normal();
    if (status === 'Optimal') return m.status_optimal();
    if (status === 'Stable') return m.status_stable();
    if (status === 'Review Required') return m.status_review_required();
    if (status === 'Manual') return m.status_manual();
    return status || '';
  }

  function getItemCountLabel(count: number) {
    return count === 1 ? m.item_count_one({ count }) : m.item_count_other({ count });
  }

  function getRecordCountLabel(count: number) {
    return count === 1 ? m.record_count_one({ count }) : m.record_count_other({ count });
  }

  function getReadingCountLabel(count: number) {
    return count === 1 ? m.reading_count_one({ count }) : m.reading_count_other({ count });
  }

  function getStatusTone(status?: string | null) {
    if (status === 'High') return 'text-rose-700 bg-rose-50 border-rose-200';
    if (status === 'Low') return 'text-orange-700 bg-orange-50 border-orange-200';
    if (status === 'Normal') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    if (status === 'Optimal') return 'text-blue-700 bg-blue-50 border-blue-200';
    return 'text-slate-700 bg-slate-50 border-slate-200';
  }

  function getStatusFromRange(
    value: number,
    range: ParsedRefRange | null,
    fallbackStatus?: string | null,
  ) {
    if (!range) return fallbackStatus || null;

    if (range.low !== null && value < range.low) return 'Low';
    if (range.high !== null && value > range.high) return 'High';
    if (range.low !== null || range.high !== null) return 'Normal';

    return fallbackStatus || null;
  }

  function stepTrendMetric(direction: -1 | 1) {
    if (trendMetrics.length === 0) return;

    const currentIndex = trendMetrics.findIndex((metric) => metric.metricName === selectedTrendMetric);
    const safeIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = (safeIndex + direction + trendMetrics.length) % trendMetrics.length;
    selectedTrendMetric = trendMetrics[nextIndex].metricName;
    trendSearchQuery = getMetricLabel(trendMetrics[nextIndex].metricName);
  }

  function selectTrendMetric(metricName: string) {
    selectedTrendMetric = metricName;
    trendSearchQuery = getMetricLabel(metricName);
    trendComboboxOpen = false;
  }

  function handleTrendComboboxKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      trendComboboxOpen = false;
      trendSearchQuery = getMetricLabel(selectedTrendMetric);
      return;
    }

    if (event.key === 'Enter' && filteredTrendMetricOptions.length > 0) {
      event.preventDefault();
      selectTrendMetric(filteredTrendMetricOptions[0].metricName);
    }
  }

  function normalizeDateTimeLocal(value?: string | null) {
    if (!value) return '';

    const trimmed = value.trim();
    if (!trimmed) return '';

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
      return local.toISOString().slice(0, 16);
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return `${trimmed}T00:00`;
    }

    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
      return trimmed.slice(0, 16);
    }

    return '';
  }

  function inferReportDateFromMetrics(metrics: any[] | null | undefined) {
    if (!metrics?.length) return '';

    for (const metric of metrics) {
      const normalized = normalizeDateTimeLocal(metric?.date);
      if (normalized) return normalized;
    }

    return '';
  }

  function shouldShowTrendPointDate(index: number, total: number) {
    if (total <= 6) return true;
    if (index === 0 || index === total - 1) return true;

    const interval = Math.max(2, Math.round(total / 5));
    return index % interval !== interval - 1;
  }

  $effect(() => {
    // Reset selection when patient changes
    data.currentPatient?.id;
    selectedRecordIds = [];
    reportFacilityName = '';
    reportTestDate = '';
    expandedReportIds = data.reports[0] ? [data.reports[0].id] : [];
  });

  $effect(() => {
    trendMetrics;

    if (!trendMetrics.length) {
      selectedTrendMetric = '';
      lastSyncedTrendMetric = '';
      trendSearchQuery = '';
      return;
    }

    if (!trendMetrics.some(({ metricName }) => metricName === selectedTrendMetric)) {
      selectedTrendMetric = trendMetrics[0].metricName;
    }

    if (selectedTrendMetric !== lastSyncedTrendMetric) {
      trendSearchQuery = selectedTrendMetric ? getMetricLabel(selectedTrendMetric) : '';
      lastSyncedTrendMetric = selectedTrendMetric;
    }
  });

  $effect(() => {
    if (!trendComboboxOpen) return;

    const selectedMetric = selectedTrendMetric;

    tick().then(() => {
      trendOptionButtons[selectedMetric]?.scrollIntoView({ block: 'nearest' });
    });
  });

  function updateFormHints() {
    if (recordType === 'blood_pressure') {
      valuePlaceholder = '120/80';
      valueLabel = m.reading_label();
    } else if (recordType === 'blood_glucose') {
      valuePlaceholder = '90';
      valueLabel = m.level_label();
    } else if (recordType === 'weight') {
      valuePlaceholder = '75.5';
      valueLabel = m.weight_label();
    } else if (recordType === 'cholesterol') {
      valuePlaceholder = '180';
      valueLabel = m.total_label();
    }
  }

  $effect(() => {
    recordType;
    updateFormHints();
  });

  let addReportForm: HTMLFormElement = $state() as HTMLFormElement;
  let hiddenMetricsInput: HTMLInputElement = $state() as HTMLInputElement;

  let pendingMetrics = $state<ReviewMetric[] | null>(null);
  let previewFileURL = $state<string | null>(null);
  let previewFileType = $state<string | null>(null);

  const reviewRequiredCount = $derived(
    pendingMetrics?.filter((metric) => metric.status === 'Review Required').length || 0,
  );

  function clearPendingReportDraft() {
    pendingMetrics = null;
    reportFacilityName = '';
    reportTestDate = '';
    reportRawSource = '';
    reviewTargetReportId = 'new';

    if (previewFileURL) {
      URL.revokeObjectURL(previewFileURL);
      previewFileURL = null;
      previewFileType = null;
    }

    extractText = '';
    extractFile = null;
    if (fileInput) fileInput.value = '';
    smartUploadActive = false;
  }

  function enhanceAddReport() {
    isSavingReport = true;

    return async ({ result, update }: any) => {
      await update({ reset: true, invalidateAll: true });

      if (result.type === 'success') {
        clearPendingReportDraft();
      }

      isSavingReport = false;
    };
  }

  function confirmAndSave() {
    if (pendingMetrics && addReportForm && hiddenMetricsInput && !isSavingReport) {
      hiddenMetricsInput.value = JSON.stringify(pendingMetrics);
      addReportForm.requestSubmit();
    }
  }

  function cancelReview() {
    clearPendingReportDraft();
  }

  async function handleExtract() {
    isExtracting = true;
    try {
      const formData = new FormData();
      if (extractText) formData.append('text', extractText);
      if (extractFile) formData.append('file', extractFile);

      const response = await fetch('/api/extract', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error(m.extract_failed());
      const apiData = (await response.json()) as any;
      const rawSource = await buildCurrentRawSource();

      const extractedReportDate = normalizeDateTimeLocal(apiData.reportDate);
      const baseMetrics = (apiData.metrics || []).map((metric: any) => ({
        ...metric,
        originalLabel: metric.originalLabel || metric.label || '',
        parsedLabel: metric.parsedLabel || metric.label || metric.type || 'Other',
        comparableValue: metric.comparableValue ?? metric.value ?? '',
        comparableUnit: metric.comparableUnit || metric.unit || '',
        comparableReferenceRange: metric.comparableReferenceRange || metric.referenceRange || '',
      }));

      const metrics = baseMetrics.map((metric: Omit<ReviewMetric, 'saveMode' | 'matchedRecordId'>) => {
        const matchedRecord = findBestRecordMatch(metric, extractedReportDate);
        const matchedReportDate = matchedRecord ? reportLookup[matchedRecord.reportId]?.testDate : null;
        const shouldDefaultToUpdate = Boolean(
          matchedRecord && extractedReportDate && getDateOnlyKey(matchedReportDate) === getDateOnlyKey(extractedReportDate),
        );

        return {
          ...metric,
          saveMode: shouldDefaultToUpdate ? 'update' : 'create',
          matchedRecordId: matchedRecord?.id || null,
        } satisfies ReviewMetric;
      });

      if (metrics.length > 0) {
        pendingMetrics = metrics;
        reportFacilityName = apiData.facilityName || reportFacilityName;
        reportTestDate = extractedReportDate || inferReportDateFromMetrics(metrics);
        reportRawSource = rawSource;
        reviewTargetReportId = 'new';
        if (previewFileURL) {
          URL.revokeObjectURL(previewFileURL);
        }

        if (extractFile) {
          previewFileURL = URL.createObjectURL(extractFile);
          previewFileType = extractFile.type || null;
        } else {
          previewFileURL = null;
          previewFileType = null;
        }
      } else {
        alert(m.no_metrics_found());
      }
    } catch (error) {
      console.error(error);
      alert(m.extract_failed());
    } finally {
      isExtracting = false;
    }
  }

  function handleFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      extractFile = file;
    }
  }

  function handleHomepageExtractFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    homepageExtractFile = target.files?.[0] || null;
  }

  function startHomepageExtractSubmit() {
    homepageExtractSubmitting = true;
  }

  let editingRecordId: string | null = $state(null);
  let editMetricName = $state('');
  let editValue = $state('');
  let editStatus = $state('');

  function startEdit(record: any) {
    editingRecordId = record.id;
    editMetricName = record.metricName;
    editValue = record.value;
    editStatus = record.status || '';
  }

  function cancelEdit() {
    editingRecordId = null;
    editMetricName = '';
  }

  async function jumpToTrendPoint(point: TrendPoint) {
    if (point.calculated && point.reportId) {
      if (!expandedReportIds.includes(point.reportId)) {
        expandedReportIds = [...expandedReportIds, point.reportId];
      }

      await tick();
      const reportTarget = document.getElementById(`report-${point.reportId}`);
      reportTarget?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const record = recordLookup[point.id];
    if (!record) return;

    if (!expandedReportIds.includes(record.reportId)) {
      expandedReportIds = [...expandedReportIds, record.reportId];
    }

    startEdit(record);
    await tick();

    const target = document.getElementById(`record-${record.id}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  let isDragging = $state(false);
  let dragCounter = $state(0);

  function handleGlobalDragEnter(e: DragEvent) {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      dragCounter++;
      isDragging = true;
    }
  }

  function handleGlobalDragLeave(e: DragEvent) {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
      isDragging = false;
    }
  }

  function handleGlobalDragOver(e: DragEvent) {
    e.preventDefault();
  }

  function handleGlobalDrop(e: DragEvent) {
    e.preventDefault();
    dragCounter = 0;
    isDragging = false;

    if (e.dataTransfer?.files?.length && data.currentPatient) {
      const file = e.dataTransfer.files[0];
      extractFile = file;
      smartUploadActive = true;
    }
  }
</script>

<svelte:window
  ondragenter={handleGlobalDragEnter}
  ondragleave={handleGlobalDragLeave}
  ondragover={handleGlobalDragOver}
  ondrop={handleGlobalDrop}
/>

{#if isDragging}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-teal-900/40 backdrop-blur-sm transition-all pointer-events-none"
  >
    <div class="bg-white px-8 py-6 rounded-2xl shadow-2xl flex flex-col items-center gap-4">
      <div class="w-16 h-16 bg-teal-100 text-teal-600 rounded-full flex items-center justify-center">
        <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
      </div>
      <h3 class="text-xl font-bold text-slate-800">{m.drag_drop_title()}</h3>
      <p class="text-slate-500 font-medium text-sm">{m.drag_drop_subtitle()}</p>
    </div>
  </div>
{/if}

<div class="min-h-screen bg-slate-50 font-sans text-slate-800 pb-10">
  <!-- Top Navigation -->
  <header class="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex justify-between items-center h-16">
        <div class="flex items-center gap-3">
          <div
            class="w-9 h-9 bg-teal-600 rounded-lg flex items-center justify-center text-white shadow-sm ring-1 ring-teal-700/50"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="2.5"
              stroke="currentColor"
              class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg
            >
          </div>
          <h1 class="text-xl font-semibold tracking-tight text-slate-900">
            {m.app_title()} <span class="text-teal-600 font-bold">{m.app_pro()}</span>
          </h1>
        </div>

        <div class="flex items-center gap-3 sm:gap-4 lg:gap-6">
          <a
            href="/admin"
            class="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-white hover:text-slate-900 sm:inline-flex"
          >
            {m.admin()}
          </a>
          <!-- Patient Selector -->
          <div class="flex items-center space-x-3">
            <form method="GET" action="/" class="flex flex-row items-center gap-2">
              <select
                name="patientId"
                onchange={(e) => e.currentTarget.form?.submit()}
                class="block w-full pl-3 pr-8 py-1.5 text-sm border-slate-300 focus:outline-none focus:ring-teal-500 focus:border-teal-500 sm:text-sm rounded-md bg-slate-50 font-medium"
              >
                {#if data.patients.length === 0}
                  <option disabled>{m.no_patients()}</option>
                {/if}
                {#each data.patients as p}
                  <option value={p.id} selected={data.currentPatient?.id === p.id}>{p.name}</option>
                {/each}
              </select>
            </form>
            <button
              onclick={() => (showPatientModal = true)}
              class="flex items-center justify-center w-7 h-7 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-teal-700 border border-slate-200 transition-colors"
              aria-label={m.nav_add_patient()}
              title={m.nav_add_patient()}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="2"
                stroke="currentColor"
                class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg
              >
            </button>
          </div>

          <div class="hidden md:block">
            <LanguageSwitcher />
          </div>

          <div class="w-px h-6 bg-slate-200 hidden sm:block"></div>

          <button
            class="text-slate-400 hover:text-teal-600 transition-colors pointer relative"
            aria-label={m.notifications()}
          >
            <span
              class="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full border border-white translate-x-1/2 -translate-y-1/2"
            ></span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="1.5"
              stroke="currentColor"
              class="w-6 h-6"
              ><path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
              /></svg
            >
          </button>

          {#if data.currentPatient}
            <div
              class="hidden sm:flex w-9 h-9 rounded-full bg-teal-100 border border-teal-200 shadow-sm overflow-hidden items-center justify-center text-teal-700 font-bold text-sm uppercase"
            >
              {data.currentPatient.name.substring(0, 2)}
            </div>
          {/if}
        </div>
      </div>

      <div class="border-t border-slate-100 px-4 py-3 md:hidden sm:px-6 lg:px-8">
        <LanguageSwitcher />
      </div>
    </div>
  </header>

  {#if showPatientModal}
    <AddPatientModal onClose={() => (showPatientModal = false)} />
  {/if}

  {#if showDeleteModal && data.currentPatient}
    <DangerZoneModal patient={data.currentPatient} records={data.records} onClose={() => (showDeleteModal = false)} />
  {/if}

  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <form
      id="edit-form"
      method="POST"
      action="?/updateRecord"
      use:enhance={() => {
        return async ({ update }) => {
          await update({ invalidateAll: true, reset: false });
          cancelEdit();
        };
      }}
      class="hidden"
    >
      <input type="hidden" name="id" value={editingRecordId} />
      <input type="hidden" name="metricName" value={editMetricName} />
      <input type="hidden" name="value" value={editValue} />
      <input type="hidden" name="status" value={editStatus} />
    </form>

    {#if data.currentPatient}
      <form bind:this={addReportForm} method="POST" action="?/addReport" use:enhance={enhanceAddReport} class="hidden">
        <input type="hidden" name="patientId" value={data.currentPatient.id} />
        <input type="hidden" name="metrics" bind:this={hiddenMetricsInput} />
        <input type="hidden" name="reportFacility" value={reportFacilityName} />
        <input type="hidden" name="reportTestDate" value={reportTestDate} />
        <input type="hidden" name="reportRawSource" value={reportRawSource} />
        <input type="hidden" name="targetReportId" value={reviewTargetReportId === 'new' ? '' : reviewTargetReportId} />
      </form>
      <datalist id="metric-parsed-label-suggestions">
        {#each metricSuggestions as suggestion}
          <option value={suggestion}></option>
        {/each}
      </datalist>
    {/if}

    {#if !data.currentPatient}
      <WelcomeWizard onCreateProfile={() => (showPatientModal = true)} />
    {:else if pendingMetrics}
      <!-- Review UI -->
      <div class="mb-8">
        <div class="flex items-center justify-between mb-6">
          <div>
            <h2 class="text-2xl font-bold text-slate-900 tracking-tight">{m.review_extracted_records()}</h2>
            <p class="text-slate-500 mt-1">{m.review_extracted_subtitle()}</p>
            <p class="mt-2 text-sm text-slate-500">{m.review_edit_hint()}</p>
            {#if reviewRequiredCount > 0}
              <div class="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-800">
                <span class="h-2 w-2 rounded-full bg-amber-500"></span>
                {m.review_required_count({ count: reviewRequiredCount })}
              </div>
            {/if}
            <label for="review-facility" class="mt-4 block max-w-md">
              <span class="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{m.lab_or_hospital()}</span>
              <input
                id="review-facility"
                type="text"
                bind:value={reportFacilityName}
                placeholder={m.enter_testing_facility()}
                class="w-full rounded-lg border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm outline-none transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />
            </label>
            <label for="review-report-date" class="mt-4 block max-w-xs">
              <span class="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{m.check_date()}</span>
              <input
                id="review-report-date"
                type="datetime-local"
                bind:value={reportTestDate}
                class="w-full rounded-lg border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm outline-none transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              />
            </label>
            <label for="review-target-report" class="mt-4 block max-w-md">
              <span class="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{m.new_records_destination()}</span>
              <select
                id="review-target-report"
                bind:value={reviewTargetReportId}
                class="w-full rounded-lg border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm outline-none transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              >
                <option value="new">{m.create_new_report()}</option>
                {#each groupedReports as group}
                  <option value={group.report.id}>{group.title}</option>
                {/each}
              </select>
            </label>
            {#if getReviewTargetReport()}
              <div class="mt-3 max-w-xl rounded-xl border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-900">
                <div class="font-semibold">{m.add_records_to_existing_report()}</div>
                <div class="mt-1">{getReportTitle(getReviewTargetReport()!)}</div>
                <div class="mt-1">{m.check_date()}: {formatDate(getReviewTargetReport()!.testDate)}</div>
              </div>
            {/if}
          </div>
          <div class="flex items-center gap-3">
            <button
              onclick={cancelReview}
              disabled={isSavingReport}
              class="px-5 py-2.5 border border-slate-300 text-slate-700 bg-white rounded-lg text-sm font-semibold hover:bg-slate-50 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-1"
            >
              {m.cancel()}
            </button>
            <button
              onclick={confirmAndSave}
              disabled={isSavingReport}
              class="px-5 py-2.5 flex items-center gap-2 border border-transparent text-white bg-teal-600 rounded-lg text-sm font-semibold hover:bg-teal-700 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-1"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="2.5"
                stroke="currentColor"
                class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg
              >
              {isSavingReport ? m.saving() : m.confirm_save()}
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <!-- Left Panel: Preview -->
          <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[700px]">
            <div class="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center">
              <svg class="w-5 h-5 text-slate-400 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"
                ><path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                ></path></svg
              >
              <h3 class="font-semibold text-slate-800">{m.original_document()}</h3>
            </div>
            <div class="flex-1 overflow-auto bg-slate-100/50 p-6 flex justify-center items-start">
              {#if previewFileURL && previewFileType?.startsWith('image/')}
                <img
                  src={previewFileURL}
                  alt={m.uploaded_document_alt()}
                  class="max-w-full h-auto rounded-lg shadow border border-slate-200"
                />
              {:else if previewFileURL && previewFileType === 'application/pdf'}
                <div class="w-full h-full bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                  <div class="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
                    <p class="font-medium text-slate-700 truncate">{extractFile?.name || parseRawReportSource(reportRawSource)?.fileName || m.uploaded_document_alt()}</p>
                    <a
                      href={previewFileURL}
                      target="_blank"
                      rel="noreferrer"
                      class="text-sm font-semibold text-teal-700 hover:text-teal-800 transition-colors"
                    >
                      {m.open_full_pdf()}
                    </a>
                  </div>
                  <iframe
                    src={previewFileURL}
                    title={m.uploaded_pdf_preview()}
                    class="w-full h-[calc(100%-57px)] bg-white"
                  ></iframe>
                </div>
              {:else if extractText}
                <div class="bg-white p-6 rounded-lg shadow border border-slate-200 w-full h-auto min-h-full">
                  <pre
                    class="text-xs text-slate-700 whitespace-pre-wrap font-mono uppercase tracking-tight">{extractText}</pre>
                </div>
              {:else}
                <div class="w-full rounded-lg border border-dashed border-slate-300 bg-white/80 p-8 text-center text-sm text-slate-500">
                  {m.no_source_preview()}
                </div>
              {/if}
            </div>
          </div>

          <!-- Right Panel: Edit Records -->
          <div class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[700px]">
            <div class="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <div class="flex items-center">
                <svg class="w-5 h-5 text-teal-600 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  ><path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  ></path></svg
                >
                <h3 class="font-semibold text-slate-800">{m.extracted_metrics()}</h3>
              </div>
              <div class="flex items-center gap-2">
                {#if reviewRequiredCount > 0}
                  <span class="text-xs font-bold bg-amber-100 text-amber-800 px-2.5 py-1 rounded-full">
                    {m.review_required_count({ count: reviewRequiredCount })}
                  </span>
                {/if}
                <span class="text-xs font-bold bg-teal-100 text-teal-800 px-2.5 py-1 rounded-full"
                  >{getItemCountLabel(pendingMetrics.length)}</span
                >
              </div>
            </div>
            <div class="flex-1 overflow-auto p-4 space-y-4 bg-slate-50/50">
              {#each pendingMetrics as metric, i}
                <div
                  class={`p-5 border rounded-xl transition-colors bg-white shadow-sm group ${metric.status === 'Review Required'
                    ? 'border-amber-300 bg-amber-50/40 shadow-amber-100/60'
                    : 'border-slate-200 hover:border-teal-400'}`}
                >
                  <div class="grid grid-cols-1 gap-5 mb-4 lg:grid-cols-2">
                    <div>
                      <label
                        for="metric-original-label-{i}"
                        class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide"
                        >{m.original_label()}</label
                      >
                        <input
                          id="metric-original-label-{i}"
                          type="text"
                          bind:value={metric.originalLabel}
                          class="w-full text-sm font-medium text-slate-700 border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none hover:border-slate-400 transition-colors"
                        />
                    </div>
                    <div>
                      <label
                        for="metric-parsed-label-{i}"
                        class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide"
                        >{m.parsed_label()}</label
                      >
                        <input
                          id="metric-parsed-label-{i}"
                          type="text"
                          bind:value={metric.parsedLabel}
                          list="metric-parsed-label-suggestions"
                          class="w-full text-sm font-semibold text-slate-900 border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none hover:border-slate-400 transition-colors"
                        />
                    </div>
                  </div>

                  <div class="grid grid-cols-1 gap-5 mb-4 lg:grid-cols-2">
                    <div>
                      <label
                        for="metric-type-{i}"
                        class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">{m.category()}</label
                      >
                        <select
                          id="metric-type-{i}"
                          bind:value={metric.type}
                          class="w-full text-sm font-medium text-slate-700 border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none hover:border-slate-400 transition-colors bg-white"
                        >
                        <option value="Blood Pressure">{getMetricLabel('Blood Pressure')}</option>
                        <option value="Blood Glucose">{getMetricLabel('Blood Glucose')}</option>
                        <option value="Weight">{getMetricLabel('Weight')}</option>
                        <option value="Cholesterol">{getMetricLabel('Cholesterol')}</option>
                        <option value="Other">{m.other()}</option>
                      </select>
                    </div>
                    <div class="flex items-end rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
                       {m.parsed_label_help()}
                     </div>
                   </div>

                  <div class="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div>
                      <label
                        for="metric-save-mode-{i}"
                        class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">{m.save_action()}</label
                      >
                      <select
                        id="metric-save-mode-{i}"
                        bind:value={metric.saveMode}
                        class="w-full text-sm font-medium text-slate-700 border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none hover:border-slate-400 transition-colors bg-white"
                      >
                        <option value="create">{m.save_as_new_record()}</option>
                        {#if getMatchedRecord(metric)}
                          <option value="update">{m.update_matched_record()}</option>
                        {/if}
                      </select>
                    </div>
                    <div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      {#if getMatchedRecord(metric)}
                        <div class="font-semibold text-slate-800">{m.matched_existing_record()}</div>
                        <div class="mt-1">{getMatchedRecord(metric)?.metricName}: {getMatchedRecord(metric)?.value}{getMatchedRecord(metric)?.unit ? ` ${getMatchedRecord(metric)?.unit}` : ''}</div>
                        <div class="mt-1">{m.check_date()}: {formatDate(reportLookup[getMatchedRecord(metric)?.reportId || '']?.testDate)}</div>
                      {:else}
                        <div class="font-semibold text-slate-800">{m.save_as_new_record()}</div>
                        <div class="mt-1">{reviewTargetReportId === 'new' ? m.create_new_report() : m.add_records_to_existing_report()}</div>
                      {/if}
                    </div>
                  </div>

                   <div class="grid grid-cols-6 gap-4 mb-4">
                    <div class="col-span-2">
                      <label
                        for="metric-val-{i}"
                        class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">{m.value()}</label
                      >
                        <input
                          id="metric-val-{i}"
                          type="text"
                          bind:value={metric.value}
                          class="w-full text-sm font-medium text-slate-900 border border-slate-300 rounded-md px-3 py-2 text-center focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none hover:border-slate-400 transition-colors"
                        />
                    </div>
                    <div class="col-span-2">
                      <label
                        for="metric-unit-{i}"
                        class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">{m.unit()}</label
                      >
                        <input
                          id="metric-unit-{i}"
                          type="text"
                          bind:value={metric.unit}
                          placeholder={m.unit_example()}
                          class="w-full text-sm text-slate-600 border border-slate-300 rounded-md px-3 py-2 text-center focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none hover:border-slate-400 transition-colors placeholder:text-slate-300"
                        />
                    </div>
                    <div class="col-span-2">
                      <label
                        for="metric-status-{i}"
                        class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">{m.status()}</label
                      >
                      <select
                        id="metric-status-{i}"
                        bind:value={metric.status}
                        class="w-full text-sm font-medium border rounded-md px-2 py-2 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-colors bg-white
                         {metric.status === 'Review Required' ? 'border-amber-300 bg-amber-50 text-amber-700 hover:border-amber-400' : 'border-slate-300 hover:border-slate-400'}
                         {metric.status === 'High' ? 'text-rose-600' : ''}
                         {metric.status === 'Low' ? 'text-orange-600' : ''}
                         {metric.status === 'Normal' ? 'text-emerald-600' : ''}
                         {metric.status === 'Optimal' ? 'text-blue-600' : ''}
                       "
                      >
                        <option value="Normal">{m.status_normal()}</option>
                        <option value="High">{m.status_high()}</option>
                        <option value="Low">{m.status_low()}</option>
                        <option value="Optimal">{m.status_optimal()}</option>
                        <option value="Stable">{m.status_stable()}</option>
                        <option value="Review Required">{m.status_review_required()}</option>
                      </select>
                    </div>
                  </div>

                  <div class="grid grid-cols-6 gap-4">
                    <div class="col-span-2">
                      <label
                        for="metric-ref-{i}"
                        class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">{m.ref_range()}</label
                      >
                        <input
                          id="metric-ref-{i}"
                          type="text"
                          bind:value={metric.referenceRange}
                          placeholder={m.ref_range_example()}
                          class="w-full text-sm font-medium text-slate-700 border border-slate-300 rounded-md px-3 py-2 text-center focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none hover:border-slate-400 transition-colors placeholder:text-slate-300"
                        />
                    </div>
                    <div class="col-span-4">
                      <label
                        for="metric-notes-{i}"
                        class="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">{m.notes()}</label
                      >
                        <input
                          id="metric-notes-{i}"
                          type="text"
                          bind:value={metric.notes}
                          placeholder={m.optional_notes_placeholder()}
                          class="w-full text-sm text-slate-700 border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none hover:border-slate-400 transition-colors placeholder:text-slate-300"
                        />
                      </div>
                    </div>

                  {#if metric.comparableValue !== '' && metric.comparableValue !== null && metric.comparableValue !== undefined && (String(metric.comparableValue) !== String(metric.value) || (metric.comparableUnit || '') !== (metric.unit || '') || (metric.comparableReferenceRange || '') !== (metric.referenceRange || ''))}
                    <div class="mt-4 rounded-lg border border-teal-200 bg-teal-50/70 px-4 py-3 text-sm text-teal-900">
                      <div class="font-semibold">{m.comparable_normalization()}</div>
                      <div class="mt-1">
                        {m.value()}: {metric.comparableValue} {metric.comparableUnit || ''}
                      </div>
                      {#if metric.comparableReferenceRange}
                        <div class="mt-1">{m.reference()}: {metric.comparableReferenceRange}</div>
                      {/if}
                    </div>
                  {/if}

                  <div class="mt-4 pt-3 border-t border-slate-100 flex justify-end">
                    <button
                      type="button"
                      onclick={() => {
                        pendingMetrics = pendingMetrics?.filter((_, idx) => idx !== i) || null;
                        if (pendingMetrics?.length === 0) cancelReview();
                      }}
                      class="text-xs font-semibold text-rose-500 hover:text-rose-700 transition-colors bg-rose-50 px-3 py-1.5 rounded-md hover:bg-rose-100"
                    >
                      {m.remove_item()}
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </div>
      </div>
    {:else}
      <div class="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 class="text-2xl font-bold text-slate-900 tracking-tight">
            {m.patient_dashboard()} <span class="text-slate-400 font-light mx-2">|</span>
            <span class="text-teal-700">{data.currentPatient.name}</span>
          </h2>
          <p class="text-slate-500 mt-1">{m.dashboard_subtitle()}</p>
        </div>
        <div class="flex items-center gap-3">
          <button
            onclick={() => (showDeleteModal = true)}
            class="flex items-center gap-2 bg-white border border-rose-200 text-rose-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-rose-50 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-1"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="2"
              stroke="currentColor"
              class="w-4 h-4"
              ><path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
              /></svg
            >
            {m.delete_profile()}
          </button>
          <button
            class="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-1"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="2"
              stroke="currentColor"
              class="w-4 h-4"
              ><path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
              /></svg
            >
            {m.export_report()}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-4 gap-8 mt-6">
        <div class="xl:col-span-1 border-slate-200">
          <div class="bg-white rounded-xl shadow-sm border border-slate-200 sticky top-24">
            <div class="px-6 py-4 border-b border-slate-100 flex flex-col gap-4 bg-slate-50/50 rounded-t-xl">
              <div class="flex items-center">
                <div class="w-1.5 h-6 bg-teal-500 rounded-full mr-3"></div>
                <h3 class="text-lg font-semibold text-slate-800">{m.add_clinical_record()}</h3>
              </div>
              <div class="flex bg-slate-200/50 p-1 rounded-lg">
                <button
                  class="flex-1 py-1.5 text-sm font-medium rounded-md transition-colors {!smartUploadActive
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'}"
                  onclick={() => (smartUploadActive = false)}
                >
                  {m.manual()}
                </button>
                <button
                  class="flex-1 py-1.5 text-sm font-medium rounded-md transition-colors {smartUploadActive
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'}"
                  onclick={() => (smartUploadActive = true)}
                >
                  {m.test_result()}
                </button>
              </div>
            </div>
            <div class="p-6">
              {#if !smartUploadActive}
                <form method="POST" action="?/addManualRecord" use:enhance class="space-y-5">
                  <input type="hidden" name="patientId" value={data.currentPatient.id} />
                  <div>
                    <label for="manual-facility" class="block text-sm font-semibold text-slate-700 mb-1.5"
                      >{m.lab_or_hospital()} <span class="text-slate-400 font-normal">({m.optional()})</span></label
                    >
                    <input
                      type="text"
                      name="facilityName"
                      id="manual-facility"
                       placeholder={m.facility_example()}
                      class="w-full rounded-lg border-slate-300 shadow-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 sm:text-sm bg-white py-2.5 px-3 border outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label for="metric-type" class="block text-sm font-semibold text-slate-700 mb-1.5"
                      >{m.metric_type()}</label
                    >
                    <div class="relative">
                      <select
                        id="metric-type"
                        name="type"
                        bind:value={recordType}
                        class="appearance-none w-full rounded-lg border-slate-300 shadow-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 sm:text-sm bg-white py-2.5 pl-3 pr-10 border outline-none transition-colors"
                      >
                         <option value="Blood Pressure">{getMetricLabel('Blood Pressure')}</option>
                         <option value="Blood Glucose">{getMetricLabel('Blood Glucose')}</option>
                         <option value="Weight">{m.body_weight()}</option>
                         <option value="Cholesterol">{getMetricLabel('Cholesterol')}</option>
                         <option value="Other">{m.other_lab_metric()}</option>
                      </select>
                      <div
                        class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-500"
                      >
                        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          ><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"
                          ></path></svg
                        >
                      </div>
                    </div>
                  </div>
                  <div>
                    <label for="metric-value" class="block text-sm font-semibold text-slate-700 mb-1.5"
                      >{valueLabel}</label
                    >
                    <input
                      type="text"
                      name="value"
                      id="metric-value"
                      placeholder={valuePlaceholder}
                      required
                      class="w-full rounded-lg border-slate-300 shadow-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 sm:text-sm bg-white py-2.5 px-3 border outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label for="date-time" class="block text-sm font-semibold text-slate-700 mb-1.5">{m.date_time()}</label>
                    <input
                      type="datetime-local"
                      name="date"
                      id="date-time"
                      class="w-full rounded-lg border-slate-300 shadow-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 sm:text-sm bg-white py-2.5 px-3 border outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label for="notes" class="block text-sm font-semibold text-slate-700 mb-1.5"
                      >{m.clinical_notes()} <span class="text-slate-400 font-normal">({m.optional()})</span></label
                    >
                    <textarea
                      name="notes"
                      id="notes"
                      rows="3"
                        placeholder={m.condition_details()}
                      class="w-full rounded-lg border-slate-300 shadow-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 sm:text-sm bg-white py-2.5 px-3 border outline-none transition-colors resize-none placeholder-slate-400"
                    ></textarea>
                  </div>
                  <div class="pt-2">
                    <button
                      type="submit"
                      class="w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 transition-all active:scale-[0.98]"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke-width="2.5"
                        stroke="currentColor"
                        class="w-4 h-4 mr-2"
                        ><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg
                      >
                      {m.save_record()}
                    </button>
                  </div>
                </form>
              {:else}
                <form method="POST" action={`/extract?/extract&patientId=${data.currentPatient.id}`} enctype="multipart/form-data" class="space-y-5" onsubmit={startHomepageExtractSubmit}>
                  <div>
                    <span class="block text-sm font-semibold text-slate-700 mb-1.5">{m.upload_document()}</span>
                    <label class="mt-1 flex cursor-pointer justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white px-6 pb-6 pt-5 transition-colors hover:border-teal-500">
                      <div class="space-y-1 text-center">
                        <svg class="mx-auto h-12 w-12 text-slate-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true"><path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                        <div class="text-sm font-medium text-teal-600">{m.upload_file()}</div>
                        <p class="text-xs text-slate-500">{m.file_size_hint()}</p>
                      </div>
                      <input name="file" type="file" accept="image/*,application/pdf" class="sr-only" onchange={handleHomepageExtractFileChange} />
                    </label>
                    {#if homepageExtractFile}
                      <p class="mt-2 text-sm font-medium text-teal-600">{m.selected_file({ name: homepageExtractFile.name })}</p>
                    {/if}
                  </div>
                  <div>
                    <label for="homepage-extract-text" class="block text-sm font-semibold text-slate-700 mb-1.5">{m.paste_raw_text()}</label>
                    <textarea
                      id="homepage-extract-text"
                      name="text"
                      rows="3"
                      placeholder={m.paste_lab_results()}
                      class="w-full rounded-lg border-slate-300 shadow-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 sm:text-sm bg-white py-2.5 px-3 border outline-none transition-colors resize-none placeholder-slate-400"
                    ></textarea>
                  </div>
                  <div class="pt-2">
                    <button
                      type="submit"
                      disabled={homepageExtractSubmitting}
                      class="w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 disabled:cursor-wait focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500 transition-all active:scale-[0.98]"
                    >
                      {#if homepageExtractSubmitting}
                        <svg class="-ml-1 mr-2 h-4 w-4 animate-spin text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        Preparing review...
                      {:else}
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-4 h-4 mr-2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"></path></svg>
                        {m.smart_extract()}
                      {/if}
                    </button>
                  </div>
                  {#if homepageExtractSubmitting}
                    <div class="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
                      Uploading the document and extracting metrics. This can take a little while for larger files.
                    </div>
                  {/if}
                </form>
              {/if}
            </div>
          </div>
        </div>

        <div class="xl:col-span-3 space-y-6">
          <div
            class="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden min-h-[500px] flex flex-col"
          >
            <div class="px-6 py-5 border-b border-slate-100 flex flex-col gap-3 bg-slate-50/50 lg:flex-row lg:items-center lg:justify-between">
              <div class="flex items-center">
                <div class="w-1.5 h-6 bg-blue-500 rounded-full mr-3"></div>
                <div>
                  <h3 class="text-lg font-semibold text-slate-800">{m.assessed_records()}</h3>
                  <p class="text-sm text-slate-500">{m.assessed_records_subtitle()}</p>
                </div>
              </div>
              <div class="flex items-center gap-4">
                {#if selectedRecordIds.length > 0}
                  <form
                    method="POST"
                    action="?/batchDeleteRecords"
                    use:enhance={(e) => {
                      if (!confirm(selectedRecordIds.length === 1 ? m.delete_records_confirm_one({ count: selectedRecordIds.length }) : m.delete_records_confirm_other({ count: selectedRecordIds.length }))) {
                        e.cancel();
                      } else {
                        return async ({ update }) => {
                          await update();
                        };
                      }
                    }}
                    class="flex items-center"
                  >
                    <input type="hidden" name="ids" value={JSON.stringify(selectedRecordIds)} />
                    <button
                      type="submit"
                      class="flex items-center gap-1.5 bg-rose-50 text-rose-600 border border-rose-200 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-rose-100 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-1"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke-width="2"
                        stroke="currentColor"
                        class="w-4 h-4"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                        />
                      </svg>
                      {m.delete_selected({ count: selectedRecordIds.length })}
                    </button>
                  </form>
                {/if}
                <div class="text-sm font-medium text-slate-500">
                  {getItemCountLabel(data.records.length)}
                </div>
              </div>
            </div>

            <div class="border-b border-slate-100 bg-[radial-gradient(circle_at_top_left,_rgba(45,212,191,0.16),_transparent_38%),linear-gradient(135deg,_#f8fffd_0%,_#eff6ff_50%,_#fff7ed_100%)] px-6 py-6">
              {#if trendMetrics.length > 0 && trendChart}
                <div class="flex flex-col gap-6">
                  <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div class="max-w-2xl">
                      <p class="text-xs font-semibold uppercase tracking-[0.22em] text-teal-700/80">{m.diachronic_view()}</p>
                      <div class="mt-2 flex flex-wrap items-end gap-3">
                        <h4 class="text-2xl font-semibold tracking-tight text-slate-900">{selectedTrendLabel}</h4>
                        <span class="rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm backdrop-blur">
                          {getReadingCountLabel(selectedTrend.points.length)}
                        </span>
                      </div>
                      {#if selectedTrendLabel !== selectedTrend.metricName}
                          <p class="mt-2 text-sm font-medium text-slate-500">{m.canonical()}: {selectedTrend.metricName}</p>
                      {/if}
                      <div class="mt-3 flex flex-wrap gap-2">
                        <span class="rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 shadow-sm backdrop-blur">
                          {getTestTypeLabel(selectedTrendTags.testType)}
                        </span>
                        {#each selectedTrendTags.categories as category}
                          <span class="rounded-full border border-white/70 bg-white/60 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm backdrop-blur">
                            {getCategoryLabel(category)}
                          </span>
                        {/each}
                      </div>
                      <p class="mt-2 text-sm text-slate-600">
                        {getMetricDescription(selectedTrend.metricName)}
                      </p>
                      <div class="mt-3 flex flex-wrap items-center gap-3 text-sm">
                        {#if selectedTrendWikipediaUrl}
                          <a
                            href={selectedTrendWikipediaUrl}
                            target="_blank"
                            rel="noreferrer"
                            class="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/80 px-3 py-1.5 font-medium text-teal-700 shadow-sm backdrop-blur transition-colors hover:bg-white"
                          >
                            <WikipediaIcon class="h-4 w-4" />
                            {m.open_wikipedia()}
                          </a>
                        {/if}
                        {#if selectedTrendWikipediaFallbackUrl && selectedTrendWikipediaFallbackUrl !== selectedTrendWikipediaUrl}
                          <a
                            href={selectedTrendWikipediaFallbackUrl}
                            target="_blank"
                            rel="noreferrer"
                            class="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/70 px-3 py-1.5 font-medium text-slate-600 shadow-sm backdrop-blur transition-colors hover:bg-white"
                          >
                            <WikipediaIcon class="h-4 w-4" />
                            {m.english_wikipedia()}
                          </a>
                        {/if}
                        {#if selectedTrendWikidataUrl}
                          <a
                            href={selectedTrendWikidataUrl}
                            target="_blank"
                            rel="noreferrer"
                            class="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/70 px-3 py-1.5 font-medium text-slate-600 shadow-sm backdrop-blur transition-colors hover:bg-white"
                          >
                            <WikidataIcon class="h-4 w-4" />
                            {m.wikidata()}
                          </a>
                        {/if}
                      </div>
                    </div>

                    <div class="min-w-[24rem] max-w-[36rem] xl:min-w-[30rem]">
                       <span class="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{m.metric()}</span>
                      <div class="flex items-start gap-2">
                        <button
                          type="button"
                          onclick={() => stepTrendMetric(-1)}
                          class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/70 bg-white/80 text-slate-500 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.6)] transition hover:text-slate-800 focus:border-teal-300 focus:outline-none focus:ring-2 focus:ring-teal-200"
                          aria-label={m.previous_metric()}
                        >
                          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
                          </svg>
                        </button>

                        <div
                          bind:this={trendComboboxContainer}
                          class="relative flex-1"
                          onfocusout={(event) => {
                            const nextTarget = event.relatedTarget as Node | null;
                            if (!nextTarget || !trendComboboxContainer?.contains(nextTarget)) {
                              trendComboboxOpen = false;
                              trendSearchQuery = selectedTrendMetric ? getMetricLabel(selectedTrendMetric) : '';
                            }
                          }}
                        >
                        <input
                          type="text"
                          bind:value={trendSearchQuery}
                          placeholder="Search biomarker"
                          class="w-full rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm font-medium text-slate-800 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.6)] outline-none transition placeholder:text-slate-400 focus:border-teal-300 focus:ring-2 focus:ring-teal-200"
                          onclick={() => (trendComboboxOpen = true)}
                          onfocus={() => (trendComboboxOpen = true)}
                          oninput={() => (trendComboboxOpen = true)}
                          onkeydown={handleTrendComboboxKeydown}
                          role="combobox"
                          aria-controls="trend-metric-listbox"
                          aria-expanded={trendComboboxOpen}
                          aria-label="Search biomarker"
                        />
                        <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
                          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                          </svg>
                        </div>
                        {#if trendComboboxOpen}
                          <div id="trend-metric-listbox" class="absolute left-0 right-0 top-[calc(100%+0.65rem)] z-20 overflow-hidden rounded-[1.4rem] border border-white/80 bg-white/95 shadow-[0_28px_60px_-28px_rgba(15,23,42,0.45)] backdrop-blur">
                            <div class="max-h-[26rem] overflow-y-auto px-2 py-2">
                              {#if groupedTrendMetricOptions.length === 0}
                                <div class="px-4 py-6 text-sm text-slate-500">No biomarker found.</div>
                              {:else}
                                {#each groupedTrendMetricOptions as group}
                                  <div class="px-2 py-2">
                                    <div class="px-2 pb-2 pt-1 text-[11px] font-bold uppercase tracking-[0.24em] text-teal-700/80">{group.label}</div>
                                    {#each group.sections as section}
                                      <div class="mb-2 rounded-2xl bg-slate-50/80 px-2 py-2">
                                        <div class="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{section.label}</div>
                                        <div class="space-y-1">
                                          {#each section.options as option}
                                            <button
                                              type="button"
                                              bind:this={trendOptionButtons[option.metricName]}
                                              onclick={() => selectTrendMetric(option.metricName)}
                                              class={`flex w-full items-start justify-between gap-3 rounded-2xl px-3 py-3 text-left transition ${selectedTrendMetric === option.metricName ? 'bg-teal-50 text-teal-900 ring-1 ring-teal-200' : 'bg-white text-slate-700 hover:bg-slate-100/80'}`}
                                            >
                                              <div class="min-w-0 flex-1">
                                                <div class="truncate text-sm font-semibold">{option.label}</div>
                                                <div class="mt-1 flex flex-wrap gap-1.5">
                                                  <span class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{option.testTypeLabel}</span>
                                                  {#each option.categoryLabels as tag}
                                                    <span class="inline-flex items-center rounded-full border border-teal-100 bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700">{tag}</span>
                                                  {/each}
                                                </div>
                                              </div>
                                              <span class="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500">{option.readingCount}</span>
                                            </button>
                                          {/each}
                                        </div>
                                      </div>
                                    {/each}
                                  </div>
                                {/each}
                              {/if}
                            </div>
                          </div>
                        {/if}
                        </div>

                        <button
                          type="button"
                          onclick={() => stepTrendMetric(1)}
                          class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/70 bg-white/80 text-slate-500 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.6)] transition hover:text-slate-800 focus:border-teal-300 focus:outline-none focus:ring-2 focus:ring-teal-200"
                          aria-label={m.next_metric()}
                        >
                          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div class="grid gap-3 md:grid-cols-3">
                    <div class="rounded-2xl border border-white/70 bg-white/75 p-4 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.8)] backdrop-blur-sm">
                      <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{m.latest()}</p>
                      <div class="mt-2 flex flex-wrap items-center gap-3">
                        <p
                          class={`text-3xl font-semibold tracking-tight ${trendChart.latestDisplayStatus === 'High'
                            ? 'text-rose-700'
                            : trendChart.latestDisplayStatus === 'Low'
                              ? 'text-orange-700'
                              : 'text-slate-900'}`}
                        >
                          {#if trendChart.latestDisplayStatus === 'High'}↑{/if}{#if trendChart.latestDisplayStatus === 'Low'}↓{/if}{trendChart.latest.rawValue}
                          {#if trendChart.latest.unit}
                            <span class="text-lg font-medium text-slate-500">{trendChart.latest.unit}</span>
                          {/if}
                        </p>
                        {#if trendChart.latestDisplayStatus}
                          <span
                            class={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusTone(trendChart.latestDisplayStatus)}`}
                          >
                            {getStatusLabel(trendChart.latestDisplayStatus)}
                          </span>
                        {/if}
                      </div>
                      {#if String(trendChart.latest.value) !== String(trendChart.latest.rawValue) || trendChart.latest.unit !== trendChart.latest.rawUnit}
                          <p class="mt-2 text-sm text-teal-700">{m.comparable_value({ value: trendChart.latest.value, unit: trendChart.latest.unit || '' })}</p>
                      {/if}
                       <p class="mt-2 text-sm text-slate-500">{m.measured_on({ date: trendChart.lastDate })}</p>
                    </div>

                    <div class="rounded-2xl border border-white/70 bg-white/75 p-4 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.8)] backdrop-blur-sm">
                      <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{m.change()}</p>
                      <p class="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                        {#if trendChart.delta === null}
                          --
                        {:else if trendChart.delta > 0}
                          +{trendChart.delta.toFixed(1)}
                        {:else}
                          {trendChart.delta.toFixed(1)}
                        {/if}
                      </p>
                      <p class="mt-2 text-sm text-slate-500">{m.compared_previous()}</p>
                    </div>

                    <div class="rounded-2xl border border-white/70 bg-white/75 p-4 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.8)] backdrop-blur-sm">
                      <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{m.reference_range()}</p>
                      <p class="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                        {trendChart.refRange?.label || m.not_available()}
                      </p>
                      <p class="mt-2 text-sm text-slate-500">{m.reference_range_hint()}</p>
                    </div>
                  </div>

                  <div class="overflow-hidden rounded-[28px] border border-white/80 bg-slate-950/[0.03] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
                    <svg viewBox={`0 0 ${trendChart.width} ${trendChart.height}`} class="h-64 w-full">
                      <defs>
                        <linearGradient id="trend-line" x1="0%" x2="100%" y1="0%" y2="0%">
                          <stop offset="0%" stop-color="#14b8a6"></stop>
                          <stop offset="100%" stop-color="#2563eb"></stop>
                        </linearGradient>
                        <linearGradient id="trend-area" x1="0%" x2="0%" y1="0%" y2="100%">
                          <stop offset="0%" stop-color="#2563eb" stop-opacity="0.28"></stop>
                          <stop offset="100%" stop-color="#2563eb" stop-opacity="0.02"></stop>
                        </linearGradient>
                      </defs>

                      {#if trendChart.refRangePath}
                        <polygon points={trendChart.refRangePath} fill="rgba(16,185,129,0.12)"></polygon>
                      {/if}

                      <line x1="20" y1="184" x2="620" y2="184" stroke="rgba(148,163,184,0.35)" stroke-width="1"></line>
                      <polygon points={trendChart.area} fill="url(#trend-area)"></polygon>
                      <polyline points={trendChart.line} fill="none" stroke="url(#trend-line)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>

                      {#each trendChart.points as point, index}
                        <g
                          role="button"
                          tabindex="0"
                          class="cursor-pointer"
                           aria-label={m.edit_trend_point({ metric: selectedTrendLabel, date: point.chartDate })}
                          onclick={() => jumpToTrendPoint(point)}
                          onkeydown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              jumpToTrendPoint(point);
                            }
                          }}
                        >
                          <circle cx={point.x} cy={point.y} r="7" fill="white" fill-opacity="0.95"></circle>
                          <circle cx={point.x} cy={point.y} r="4.5" fill="#0f766e"></circle>
                          <text
                            x={point.x}
                            y={Math.max(point.y - 14, 16)}
                            text-anchor="middle"
                            class="fill-slate-700 text-[11px] font-semibold"
                          >{point.rawValue}</text>
                          {#if shouldShowTrendPointDate(index, trendChart.points.length)}
                            <text x={point.x} y="208" text-anchor="middle" class="fill-slate-500 text-[11px]">{point.chartDate}</text>
                          {/if}
                        </g>
                      {/each}
                    </svg>
                  </div>
                </div>
              {:else}
                <div class="rounded-[28px] border border-dashed border-slate-300/90 bg-white/70 p-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-sm">
                  <p class="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{m.diachronic_view()}</p>
                  <h4 class="mt-3 text-xl font-semibold text-slate-900">{m.no_plot_title()}</h4>
                  <p class="mx-auto mt-2 max-w-xl text-sm text-slate-600">
                    {m.no_plot_description()}
                  </p>
                </div>
              {/if}
            </div>

            <div class="flex-1 overflow-x-auto">
              {#if data.records.length === 0}
                <div class="flex flex-col items-center justify-center p-12 text-slate-400">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width="1.5"
                    stroke="currentColor"
                    class="w-12 h-12 mb-4 opacity-50"
                    ><path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                    /></svg
                  >
                  <p class="text-sm font-medium">{m.no_records_for_patient()}</p>
                  <p class="text-xs mt-1">{m.no_records_hint()}</p>
                </div>
              {:else}
                <div class="border-t border-slate-100">
                  <div class="flex items-center gap-3 px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 bg-slate-50/50">
                    <input
                      type="checkbox"
                      checked={allRecordsSelected}
                      onchange={toggleSelectAll}
                      class="rounded border-slate-300 text-teal-600 focus:ring-teal-500 h-4 w-4 cursor-pointer"
                    />
                    <span>{m.select_all_records()}</span>
                  </div>

                  {#each groupedReports as group}
                    <section id={`report-${group.report.id}`} class="border-t border-slate-100 first:border-t-0">
                      {#if isReportExpanded(group.report.id)}
                        <div class="border-t border-slate-100 bg-white px-6 py-5">
                          <form method="POST" action="?/updateReport" use:enhance class="space-y-4">
                            <input type="hidden" name="id" value={group.report.id} />
                            <div class="flex items-start justify-between gap-4">
                              <div class="min-w-0 flex-1 space-y-3">
                                <label class="block">
                                  <span class="sr-only">{m.report_title()}</span>
                                  <input
                                    type="text"
                                    name="title"
                                    value={group.title}
                                    placeholder={`${group.facilityName || m.report_fallback()} ${formatDate(group.report.testDate, { dateStyle: 'medium' })}`}
                                    class="w-full border-0 bg-transparent px-0 py-0 text-lg font-semibold tracking-tight text-slate-900 outline-none placeholder:text-slate-400 focus:ring-0"
                                  />
                                </label>
                                <label class="block">
                                  <span class="sr-only">{m.report_notes()}</span>
                                  <textarea
                                    name="notes"
                                    rows="2"
                                    placeholder={m.report_notes_placeholder()}
                                    class="w-full resize-none border-0 bg-transparent px-0 py-0 text-sm text-slate-500 outline-none placeholder:text-slate-400 focus:ring-0"
                                  >{group.notes}</textarea>
                                </label>
                              </div>

                              <div class="flex items-center gap-2">
                                <a
                                  href={`/reports/${group.report.id}/review`}
                                  data-sveltekit-reload
                                  class="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700 transition-colors hover:bg-teal-100"
                                >
                                  {m.review_report()}
                                </a>
                                <button
                                  type="button"
                                  onclick={() => toggleReportExpanded(group.report.id)}
                                  class="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                                  aria-label={m.collapse_report()}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="h-5 w-5">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 15l-7-7-7 7" />
                                  </svg>
                                </button>
                              </div>
                            </div>

                            <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                              <div class="flex flex-wrap items-center gap-3">
                                <input
                                  type="datetime-local"
                                  name="testDate"
                                  value={group.report.testDate ? group.report.testDate.slice(0, 16) : ''}
                                  class="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                                />
                                <input
                                  type="text"
                                  name="facilityName"
                                  value={group.facilityName}
                                  placeholder={m.facility()}
                                  class="min-w-40 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                                />
                              </div>
                              <button
                                type="submit"
                                class="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                              >
                                {m.save()}
                              </button>
                            </div>
                          </form>

                          <form
                            method="POST"
                            action="?/deleteReport"
                            use:enhance={(e) => {
                              if (!confirm(group.records.length === 1 ? m.delete_report_confirm_one({ count: group.records.length }) : m.delete_report_confirm_other({ count: group.records.length }))) {
                                e.cancel();
                              }
                            }}
                            class="mt-3 flex justify-end"
                          >
                            <input type="hidden" name="id" value={group.report.id} />
                            <button
                              type="submit"
                              class="inline-flex items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-100"
                            >
                              {m.remove_report()}
                            </button>
                          </form>

                          <div class="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                            <table class="min-w-full divide-y divide-slate-200">
                              <thead class="bg-slate-50/70">
                                <tr>
                                  <th scope="col" class="px-6 py-3.5 w-10 text-left">
                                    <input
                                      type="checkbox"
                                      checked={allReportRecordsSelected(group.report.id)}
                                      onchange={() => toggleSelectReport(group.report.id)}
                                      class="rounded border-slate-300 text-teal-600 focus:ring-teal-500 h-4 w-4 cursor-pointer"
                                    />
                                  </th>
                                  <th scope="col" class="px-2 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{m.type()}</th>
                                  <th scope="col" class="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{m.value()}</th>
                                  <th scope="col" class="px-6 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{m.status()}</th>
                                  <th scope="col" class="relative px-6 py-3.5 w-10 text-right"><span class="sr-only">{m.actions()}</span></th>
                                </tr>
                              </thead>
                              <tbody class="bg-white divide-y divide-slate-100">
                                {#each group.records as record}
                      {#if editingRecordId === record.id}
                        <tr id={`record-${record.id}`} class="bg-blue-50/50 border-l-[3px] border-l-blue-500 group">
                          <td class="px-6 py-4 whitespace-nowrap">
                            <!-- spacer for checkbox in edit view so UI doesn't jump -->
                          </td>
                          <td class="px-2 py-4 whitespace-nowrap">
                            <div class="space-y-1">
                              <input
                                type="text"
                                name="metricName"
                                bind:value={editMetricName}
                                list="metric-parsed-label-suggestions"
                                required
                                class="w-full text-sm font-semibold text-slate-900 border border-blue-300 bg-white rounded px-2 py-1 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                              />
                              {#if getRecordOriginalLabel(record)}
                                <div class="text-xs text-slate-400">{m.original_prefix({ value: getRecordOriginalLabel(record) })}</div>
                              {/if}
                            </div>
                          </td>
                          <td class="px-6 py-3 whitespace-nowrap">
                            <input
                              type="text"
                              name="value"
                              bind:value={editValue}
                              required
                              class="w-full text-sm font-medium text-slate-900 border border-blue-300 bg-white rounded px-2 py-1 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            />
                          </td>
                          <td class="px-6 py-3 whitespace-nowrap">
                            <select
                              name="status"
                              bind:value={editStatus}
                              class="w-full text-sm border border-blue-300 bg-white rounded px-2 py-1 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            >
                              <option value="Normal">{m.status_normal()}</option>
                              <option value="High">{m.status_high()}</option>
                              <option value="Low">{m.status_low()}</option>
                              <option value="Optimal">{m.status_optimal()}</option>
                              <option value="Stable">{m.status_stable()}</option>
                              <option value="Review Required">{m.status_review_required()}</option>
                              <option value="Manual">{m.status_manual()}</option>
                            </select>
                          </td>
                          <td class="px-6 py-4 whitespace-nowrap text-right">
                            <div class="flex items-center justify-end gap-2">
                              <button
                                type="submit"
                                form="edit-form"
                                class="text-white bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded-md text-xs font-medium transition-colors shadow-sm"
                                aria-label={m.save_record()}>{m.save_record_short()}</button
                              >
                              <button
                                type="button"
                                onclick={cancelEdit}
                                class="text-slate-500 hover:text-slate-700 hover:bg-slate-200 px-2 py-1 rounded-md text-xs font-medium transition-colors"
                                aria-label={m.cancel_editing()}>{m.cancel()}</button
                              >
                            </div>
                          </td>
                        </tr>
                      {:else}
                        <tr
                          id={`record-${record.id}`}
                          class="hover:bg-slate-50/70 transition-colors group {selectedRecordIds.includes(record.id)
                            ? 'bg-teal-50/30'
                            : ''}"
                        >
                          <td class="px-6 py-4 whitespace-nowrap">
                            <input
                              type="checkbox"
                              bind:group={selectedRecordIds}
                              value={record.id}
                              class="rounded border-slate-300 text-teal-600 focus:ring-teal-500 h-4 w-4 cursor-pointer"
                            />
                          </td>
                          <td class="px-2 py-4 whitespace-nowrap">
                            <div class="flex items-center">
                              <div>
                                <div class="text-sm font-semibold text-slate-800">{record.metricName}</div>
                                {#if getRecordOriginalLabel(record)}
                                  <div class="mt-1 text-xs text-slate-400">{getRecordOriginalLabel(record)}</div>
                                {/if}
                              </div>
                            </div>
                          </td>
                          <td class="px-6 py-4 whitespace-nowrap">
                            <div class="text-sm text-slate-700 font-medium">
                              {record.value} <span class="text-slate-500 ml-1">{record.unit || ''}</span>
                            </div>
                            {#if getRecordComparableValue(record) !== null && (String(getRecordComparableValue(record)) !== String(record.value) || getRecordComparableUnit(record) !== (record.unit || null))}
                              <div class="text-xs text-teal-700 mt-1">
                                {m.comparable_prefix({ value: String(getRecordComparableValue(record) ?? ''), unit: getRecordComparableUnit(record) || '' })}
                              </div>
                            {/if}
                            {#if record.refRange}
                              <div class="text-xs text-slate-400 mt-1">{m.ref_prefix({ value: record.refRange })}</div>
                            {/if}
                          </td>
                          <td class="px-6 py-4 whitespace-nowrap">
                            <span
                              class="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full border
                            {record.status === 'Normal' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : ''}
                            {record.status === 'Optimal' ? 'bg-blue-50 text-blue-700 border-blue-200' : ''}
                            {record.status === 'High' ? 'bg-rose-50 text-rose-700 border-rose-200' : ''}
                            {record.status === 'Low' ? 'bg-orange-50 text-orange-700 border-orange-200' : ''}
                            {record.status === 'Stable' ? 'bg-slate-50 text-slate-700 border-slate-200' : ''}
                            {record.status === 'Review Required' ? 'bg-amber-50 text-amber-700 border-amber-200' : ''}
                            {record.status === 'Manual' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : ''}"
                            >
                              {getStatusLabel(record.status)}
                            </span>
                          </td>
                          <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <div class="flex items-center justify-end gap-2">
                              <button
                                onclick={() => startEdit(record)}
                                class="text-slate-400 hover:text-blue-600 transition-colors p-1.5 rounded-md hover:bg-blue-50 opacity-0 group-hover:opacity-100 focus:opacity-100"
                                aria-label={m.edit_record()}
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke-width="2"
                                  stroke="currentColor"
                                  class="w-4 h-4"
                                  ><path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"
                                  /></svg
                                >
                              </button>
                              <form
                                method="POST"
                                action="?/deleteRecord"
                                use:enhance={(e) => {
                                  if (!confirm(m.delete_record_confirm())) {
                                    e.cancel();
                                  }
                                }}
                                class="contents"
                              >
                                <input type="hidden" name="id" value={record.id} />
                                <button
                                  type="submit"
                                  class="text-slate-400 hover:text-rose-600 transition-colors p-1.5 rounded-md hover:bg-rose-50 opacity-0 group-hover:opacity-100 focus:opacity-100"
                                  aria-label={m.delete_record()}
                                >
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke-width="2"
                                    stroke="currentColor"
                                    class="w-4 h-4"
                                    ><path
                                      stroke-linecap="round"
                                      stroke-linejoin="round"
                                      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                                    /></svg
                                  >
                                </button>
                              </form>
                            </div>
                          </td>
                        </tr>
                      {/if}
                                {/each}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      {:else}
                        <button
                          type="button"
                          onclick={() => toggleReportExpanded(group.report.id)}
                          class="flex w-full items-start justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-slate-50/70"
                        >
                          <div class="min-w-0 flex-1">
                            <div class="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                              <div class="min-w-0">
                                <h4 class="truncate text-lg font-semibold tracking-tight text-slate-900">{group.title}</h4>
                                <p class="mt-1 text-sm text-slate-500">{formatDate(group.report.testDate)} - {getRecordCountLabel(group.records.length)}</p>
                              </div>
                              {#if group.facilityName}
                                <span class="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                                  {group.facilityName}
                                </span>
                              {/if}
                            </div>
                            {#if group.notes}
                              <p class="mt-2 line-clamp-2 max-w-3xl text-sm text-slate-500">{group.notes}</p>
                            {/if}
                          </div>
                          <div class="flex items-center gap-3 pt-1">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke-width="2"
                              stroke="currentColor"
                              class="h-5 w-5 text-slate-400"
                            ><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
                          </div>
                        </button>
                      {/if}
                    </section>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        </div>
      </div>
    {/if}
  </main>
</div>
