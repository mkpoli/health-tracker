<script lang="ts">
  import { tick } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime';
  import WikipediaIcon from '~icons/simple-icons/wikipedia';
  import WikidataIcon from '~icons/simple-icons/wikidata';
  import {
    getMetricDefinition,
    getMetricTags,
    getMetricWikipediaFallbackUrl,
    getMetricWikipediaUrl,
    getMetricWikidataUrl,
  } from '$lib/metrics/catalog';
  import { getCategoryLabel, getMetricDescription, getMetricLabel, getTestTypeLabel } from '$lib/metrics/labels';
  import {
    canonicalUnitForm,
    convertValueBetweenUnits,
    formatConvertedValue,
  } from '$lib/metrics/normalization';
  import {
    getStatusFromRange,
    getStatusLabel,
    getStatusTone,
    parseReferenceRange,
    type ParsedRefRange,
    type TrendMetricGroup,
    type TrendPoint,
  } from '$lib/metrics/trends';
  import { assessEvidence, contextsComparable, therapyRangesForValue, verdictApplies } from '$lib/health/summary';
  import RefRangePicker from './RefRangePicker.svelte';

  // The diachronic view, shared by every dashboard section so lab results,
  // body measurements and vitals all read the same way over time.
  let {
    metrics = [],
    patient,
    formatDate,
    accent = 'teal',
    onJumpToPoint,
  }: {
    metrics?: TrendMetricGroup[];
    /** Matches the section this view sits in. */
    accent?: 'teal' | 'violet' | 'rose';
    patient: { agab?: string | null; birthday?: string | null } | null;
    formatDate: (value: string | null, options?: Intl.DateTimeFormatOptions) => string;
    onJumpToPoint?: (point: TrendPoint) => void;
  } = $props();

  let selectedTrendMetric = $state('');
  let trendSearchQuery = $state('');
  let trendComboboxOpen = $state(false);
  let lastSyncedTrendMetric = $state('');
  let trendComboboxContainer = $state<HTMLDivElement | null>(null);
  let trendOptionButtons = $state<Record<string, HTMLButtonElement | null>>({});
  let trendUnitDisplay = $state<Record<string, string>>({});
  let trendRefRangeOverride = $state<Record<string, string>>({});

  const currentLocale = $derived(getLocale());
  const trendMetrics = $derived(metrics);

  // Spelled out per accent, since Tailwind needs the class names whole and the
  // SVG gradients need literal colours.
  const ACCENTS = {
    teal: {
      wash: 'bg-[radial-gradient(circle_at_top_left,_rgba(45,212,191,0.16),_transparent_38%),linear-gradient(135deg,_#f8fffd_0%,_#eff6ff_50%,_#fff7ed_100%)]',
      eyebrow: 'text-teal-700/80',
      link: 'text-teal-700',
      linkHover: 'hover:text-teal-900',
      focus: 'focus:border-teal-300 focus:ring-teal-200',
      optionActive: 'bg-teal-50 text-teal-900 ring-1 ring-teal-200',
      chip: 'border-teal-100 bg-teal-50 text-teal-700',
      toggleActive: 'bg-teal-600 text-white shadow-sm',
      lineFrom: '#14b8a6',
      lineTo: '#2563eb',
      area: '#2563eb',
      dot: '#0f766e',
    },
    violet: {
      wash: 'bg-[radial-gradient(circle_at_top_left,_rgba(167,139,250,0.18),_transparent_38%),linear-gradient(135deg,_#fbfaff_0%,_#f5f3ff_50%,_#fdf4ff_100%)]',
      eyebrow: 'text-violet-700/80',
      link: 'text-violet-700',
      linkHover: 'hover:text-violet-900',
      focus: 'focus:border-violet-300 focus:ring-violet-200',
      optionActive: 'bg-violet-50 text-violet-900 ring-1 ring-violet-200',
      chip: 'border-violet-100 bg-violet-50 text-violet-700',
      toggleActive: 'bg-violet-600 text-white shadow-sm',
      lineFrom: '#a78bfa',
      lineTo: '#7c3aed',
      area: '#7c3aed',
      dot: '#6d28d9',
    },
    rose: {
      wash: 'bg-[radial-gradient(circle_at_top_left,_rgba(251,113,133,0.16),_transparent_38%),linear-gradient(135deg,_#fffafb_0%,_#fff1f2_50%,_#fff7ed_100%)]',
      eyebrow: 'text-rose-700/80',
      link: 'text-rose-700',
      linkHover: 'hover:text-rose-900',
      focus: 'focus:border-rose-300 focus:ring-rose-200',
      optionActive: 'bg-rose-50 text-rose-900 ring-1 ring-rose-200',
      chip: 'border-rose-100 bg-rose-50 text-rose-700',
      toggleActive: 'bg-rose-600 text-white shadow-sm',
      lineFrom: '#fb7185',
      lineTo: '#e11d48',
      area: '#e11d48',
      dot: '#be123c',
    },
  } as const;

  const tone = $derived(ACCENTS[accent]);
  // Gradient ids must be unique per instance or all three sections share one.
  const gradientId = $derived(`trend-${accent}`);

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

  function getReadingCountLabel(count: number) {
    return count === 1 ? m.reading_count_one({ count }) : m.reading_count_other({ count });
  }

  function normalizeMetricMatchKey(value: unknown) {
    if (typeof value !== 'string') return '';

    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

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
      {
        key: string;
        label: string;
        sections: Map<string, { key: string; label: string; options: TrendMetricOption[] }>;
      }
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

    const metricName = selectedTrend?.metricName ?? '';
    const latest = series[series.length - 1];

    // Y is always plotted in the canonical comparable-unit space (so points
    // with different rawUnits land at heights you can actually compare). Labels
    // are rendered separately, in whichever display unit the user picked.
    const plotValues = series.map((p) => p.value);

    const override = trendRefRangeOverride[metricName] ?? null;
    const overrideRange = override ? parseReferenceRange(override) : null;
    const parsedRanges = series.map((point) => parseReferenceRange(point.refRange)).filter(Boolean) as ParsedRefRange[];
    const bounds: number[] = [...plotValues];

    // The override range comes in as text typed against the picker's "current
    // unit" (the latest record's comparable unit), so its numbers are already
    // in the chart's comparable-unit space. Recorded ranges come from each
    // point's raw refRange string and were normalized into comparable units in
    // trendMetrics — same space.
    const rangesForBounds = overrideRange ? [overrideRange] : parsedRanges;
    for (const range of rangesForBounds) {
      if (range.low !== null) bounds.push(range.low);
      if (range.high !== null) bounds.push(range.high);
    }

    const rawMin = Math.min(...bounds);
    const rawMax = Math.max(...bounds);
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

    const line = plotValues.map((v, index) => `${xForIndex(index)},${yForValue(v)}`).join(' ');
    const area = `${line} ${xForIndex(series.length - 1)},${height - bottom} ${xForIndex(0)},${height - bottom}`;

    const previous = series.length > 1 ? series[series.length - 2] : null;
    const activeRange =
      overrideRange ||
      parseReferenceRange(latest.refRange) ||
      parsedRanges.find((range) => range.low !== null || range.high !== null) ||
      null;
    // The same two rules the read model applies, called rather than restated:
    // a fasting interval says nothing about a draw taken after a meal, and a
    // laboratory's interval describes someone who is not on hormone therapy.
    const metricKey = getMetricDefinition(latest.metricName).key;
    const verdictHolds = verdictApplies(metricKey, latest.collectionContext);
    const latestDisplayStatus = verdictHolds
      ? getStatusFromRange(latest.value, activeRange, latest.status)
      : null;
    const therapyRanges = therapyRangesForValue(metricKey, latest.value, latest.unit);
    // Subtracting a post-meal reading from a fasting one measures the meal.
    const deltaComparable =
      !previous || contextsComparable(metricKey, latest.collectionContext, previous.collectionContext);
    const delta = previous && deltaComparable ? latest.value - previous.value : null;

    let refRangePath = '';
    // 'solid' = both bounds; 'fadeDown' = only upper bound (<X), fade toward
    // chart bottom; 'fadeUp' = only lower bound (>X), fade toward chart top.
    let refRangeFill: 'solid' | 'fadeDown' | 'fadeUp' = 'solid';

    if (activeRange) {
      const hasLow = activeRange.low !== null;
      const hasHigh = activeRange.high !== null;
      const chartTopY = top;
      const chartBottomY = height - bottom;

      if (hasLow && hasHigh) {
        const upper = `${left},${yForValue(activeRange.high!)} ${width - right},${yForValue(activeRange.high!)}`;
        const lower = `${width - right},${yForValue(activeRange.low!)} ${left},${yForValue(activeRange.low!)}`;
        refRangePath = `${upper} ${lower}`;
      } else if (hasHigh) {
        // <X — band from chart bottom up to high; fade toward bottom.
        const highY = yForValue(activeRange.high!);
        refRangePath = `${left},${highY} ${width - right},${highY} ${width - right},${chartBottomY} ${left},${chartBottomY}`;
        refRangeFill = 'fadeDown';
      } else if (hasLow) {
        // >X — band from low up to chart top; fade toward top.
        const lowY = yForValue(activeRange.low!);
        refRangePath = `${left},${chartTopY} ${width - right},${chartTopY} ${width - right},${lowY} ${left},${lowY}`;
        refRangeFill = 'fadeUp';
      }
    }

    const rawUnits = new Set(series.map((point) => point.rawUnit || '').filter(Boolean));
    const hasMixedUnits = rawUnits.size > 1;
    // Where eating moves the number, a line through fasting and post-meal
    // readings charts the meals rather than the body.
    // Whether this series can carry a direction at all. A line through five
    // points spread over nine years looks like a trend and is not one.
    const evidence = assessEvidence(metricKey, series as never);
    const drawContexts = [...new Set(series.map((point) => point.collectionContext))];
    const hasMixedDraws =
      drawContexts.length > 1 && !contextsComparable(metricKey, drawContexts[0], drawContexts[1]);
    const overrideActive = Boolean(overrideRange);

    const unitCandidateSet = new Set<string>();
    for (const point of series) {
      const r = canonicalUnitForm(point.rawUnit);
      if (r) unitCandidateSet.add(r);
      const c = canonicalUnitForm(point.unit);
      if (c) unitCandidateSet.add(c);
    }
    const unitOptions = Array.from(unitCandidateSet);

    return {
      width,
      height,
      line,
      area,
      points: series.map((point, index) => ({
        ...point,
        x: xForIndex(index),
        y: yForValue(plotValues[index]),
      })),
      firstDate: series[0].formattedDate,
      lastDate: latest.formattedDate,
      latest,
      latestDisplayStatus,
      verdictHolds,
      therapyRanges,
      delta,
      deltaComparable,
      refRange: activeRange,
      refRangePath,
      refRangeFill,
      hasMixedUnits,
      hasMixedDraws,
      evidence,
      overrideActive,
      unitOptions,
    };
  });

  const currentTrendUnitMode = $derived.by(() => {
    if (!selectedTrend) return 'asRecorded';
    return trendUnitDisplay[selectedTrend.metricName] || 'asRecorded';
  });

  const trendDisplay = $derived.by(() => {
    if (!trendChart || !selectedTrend) return null;
    const mode = currentTrendUnitMode;
    const latestRendered = renderTrendPointLabel(trendChart.latest, mode);

    const points = selectedTrend.points;
    let delta: number | null = null;
    // Same rule as the chart: readings drawn under different conditions are not
    // subtracted, whichever unit they are displayed in.
    if (points.length > 1 && trendChart.deltaComparable) {
      const previousRendered = renderTrendPointLabel(points[points.length - 2], mode);
      const latestNum = Number(latestRendered.value);
      const previousNum = Number(previousRendered.value);
      if (Number.isFinite(latestNum) && Number.isFinite(previousNum)) {
        delta = latestNum - previousNum;
      }
    }

    const refSourceUnit = canonicalUnitForm(trendChart.latest.rawUnit);
    const refRangeLabel = trendChart.refRange
      ? convertRefRangeText(trendChart.refRange.label, refSourceUnit, latestRendered.unit) || trendChart.refRange.label
      : null;

    return {
      latestValue: latestRendered.value,
      latestUnit: latestRendered.unit,
      delta,
      refRangeLabel,
    };
  });

  function renderTrendPointLabel(point: TrendPoint, mode: string): { value: string; unit: string | null } {
    if (mode === 'asRecorded') {
      return { value: point.rawValue, unit: canonicalUnitForm(point.rawUnit) };
    }
    const source = canonicalUnitForm(point.rawUnit);
    const sourceValueRaw = Number(point.rawValue);
    const sourceValue = Number.isFinite(sourceValueRaw) ? sourceValueRaw : point.value;
    if (source === mode) {
      return { value: formatConvertedValue(sourceValue), unit: mode };
    }
    const converted = convertValueBetweenUnits(sourceValue, source, mode);
    if (converted === null) {
      return { value: point.rawValue, unit: canonicalUnitForm(point.rawUnit) };
    }
    return { value: formatConvertedValue(converted), unit: mode };
  }

  function convertRefRangeText(refRange: string | null | undefined, fromUnit: string | null | undefined, toUnit: string | null | undefined): string | null {
    if (!refRange) return null;
    if (!toUnit || !fromUnit || canonicalUnitForm(fromUnit) === canonicalUnitForm(toUnit)) return refRange;
    return refRange.replace(/(?<![\d.])[+-]?\d*\.?\d+/g, (match) => {
      const parsed = Number(match);
      if (!Number.isFinite(parsed)) return match;
      const converted = convertValueBetweenUnits(parsed, fromUnit, toUnit);
      return converted === null ? match : formatConvertedValue(converted);
    });
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

  // A year of daily readings is hundreds of points. Drawing a marker, a value
  // and a date for each one buries the line under its own annotation, so what
  // gets drawn depends on how many points there are.
  const CHART_MAX_MARKERS = 160;

  const chartDensity = $derived.by(() => {
    const count = trendChart?.points.length ?? 0;

    return {
      count,
      fullMarkers: count <= 40,
      smallMarkers: count > 40,
      labelEveryPoint: count <= 10,
    };
  });

  /** First, last, lowest and highest — the points worth naming on any series. */
  const emphasisIndices = $derived.by(() => {
    const points = trendChart?.points ?? [];
    if (points.length === 0) return new Set<number>();

    let lowest = 0;
    let highest = 0;

    points.forEach((point, index) => {
      if (point.value < points[lowest].value) lowest = index;
      if (point.value > points[highest].value) highest = index;
    });

    return new Set([0, points.length - 1, lowest, highest]);
  });

  /** At most five evenly spaced dates along the axis. */
  const dateTickIndices = $derived.by(() => {
    const count = trendChart?.points.length ?? 0;
    if (count === 0) return new Set<number>();
    if (count <= 6) return new Set(Array.from({ length: count }, (_, index) => index));

    const ticks = new Set<number>();
    const steps = 4;
    for (let step = 0; step <= steps; step += 1) {
      ticks.add(Math.round((step * (count - 1)) / steps));
    }
    return ticks;
  });

  /** Keeps the node count bounded on a long series. */
  const renderedIndices = $derived.by(() => {
    const count = trendChart?.points.length ?? 0;
    if (count === 0) return new Set<number>();
    if (count <= CHART_MAX_MARKERS) return new Set(Array.from({ length: count }, (_, index) => index));

    const stride = Math.ceil(count / CHART_MAX_MARKERS);
    const kept = new Set<number>();
    for (let index = 0; index < count; index += stride) kept.add(index);
    for (const index of emphasisIndices) kept.add(index);
    for (const index of dateTickIndices) kept.add(index);
    return kept;
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

  // Dismissal watches for a pointer landing outside the combobox rather than
  // for the input losing focus. iOS does not focus a button when it is tapped,
  // so a focusout-based close tore the option list down before the tap on it
  // could register.
  $effect(() => {
    if (!trendComboboxOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && trendComboboxContainer?.contains(target)) return;

      trendComboboxOpen = false;
      trendSearchQuery = selectedTrendMetric ? getMetricLabel(selectedTrendMetric) : '';
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  });

  function jumpToTrendPoint(point: TrendPoint) {
    onJumpToPoint?.(point);
  }
</script>

              <div
                class="border-b border-slate-100 px-4 py-6 sm:px-6 {tone.wash}"
              >
                {#if trendMetrics.length > 0 && trendChart}
                  <div class="flex flex-col gap-6">
                    <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div class="max-w-2xl">
                        <p class="text-xs font-semibold uppercase tracking-[0.22em] {tone.eyebrow}">
                          {m.diachronic_view()}
                        </p>
                        <div class="mt-2 flex flex-wrap items-end gap-3">
                          <h4 class="text-2xl font-semibold tracking-tight text-slate-900">{selectedTrendLabel}</h4>
                          <span
                            class="rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm backdrop-blur"
                          >
                            {getReadingCountLabel(selectedTrend.points.length)}
                          </span>
                        </div>
                        {#if selectedTrendLabel !== selectedTrend.metricName}
                          <p class="mt-2 text-sm font-medium text-slate-500">
                            {m.canonical()}: {selectedTrend.metricName}
                          </p>
                        {/if}
                        <div class="mt-3 flex flex-wrap gap-2">
                          <span
                            class="rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 shadow-sm backdrop-blur"
                          >
                            {getTestTypeLabel(selectedTrendTags.testType)}
                          </span>
                          {#each selectedTrendTags.categories as category}
                            <span
                              class="rounded-full border border-white/70 bg-white/60 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm backdrop-blur"
                            >
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
                              class="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/80 px-3 py-1.5 font-medium {tone.link} shadow-sm backdrop-blur transition-colors hover:bg-white"
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
                        <span class="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-500"
                          >{m.metric()}</span
                        >
                        <div class="flex items-start gap-2">
                          <button
                            type="button"
                            onclick={() => stepTrendMetric(-1)}
                            class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/70 bg-white/80 text-slate-500 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.6)] transition hover:text-slate-800 focus:outline-none focus:ring-2 {tone.focus}"
                            aria-label={m.previous_metric()}
                          >
                            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"
                              ></path>
                            </svg>
                          </button>

                          <div bind:this={trendComboboxContainer} class="relative flex-1">
                            <input
                              type="text"
                              bind:value={trendSearchQuery}
                              placeholder={m.search_biomarker()}
                              class="w-full rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm font-medium text-slate-800 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.6)] outline-none transition placeholder:text-slate-400 focus:ring-2 {tone.focus}"
                              onclick={() => (trendComboboxOpen = true)}
                              onfocus={() => (trendComboboxOpen = true)}
                              oninput={() => (trendComboboxOpen = true)}
                              onkeydown={handleTrendComboboxKeydown}
                              role="combobox"
                              aria-controls="trend-metric-listbox"
                              aria-expanded={trendComboboxOpen}
                              aria-label={m.search_biomarker()}
                            />
                            <div
                              class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400"
                            >
                              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"
                                ></path>
                              </svg>
                            </div>
                            {#if trendComboboxOpen}
                              <div
                                id="trend-metric-listbox"
                                class="absolute left-0 right-0 top-[calc(100%+0.65rem)] z-20 overflow-hidden rounded-[1.4rem] border border-white/80 bg-white/95 shadow-[0_28px_60px_-28px_rgba(15,23,42,0.45)] backdrop-blur"
                              >
                                <div class="max-h-[26rem] overflow-y-auto px-2 py-2">
                                  {#if groupedTrendMetricOptions.length === 0}
                                    <div class="px-4 py-6 text-sm text-slate-500">{m.no_biomarker_found()}</div>
                                  {:else}
                                    {#each groupedTrendMetricOptions as group}
                                      <div class="px-2 py-2">
                                        <div
                                          class="px-2 pb-2 pt-1 text-[11px] font-bold uppercase tracking-[0.24em] {tone.eyebrow}"
                                        >
                                          {group.label}
                                        </div>
                                        {#each group.sections as section}
                                          <div class="mb-2 rounded-2xl bg-slate-50/80 px-2 py-2">
                                            <div
                                              class="px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500"
                                            >
                                              {section.label}
                                            </div>
                                            <div class="space-y-1">
                                              {#each section.options as option}
                                                <button
                                                  type="button"
                                                  bind:this={trendOptionButtons[option.metricName]}
                                                  onclick={() => selectTrendMetric(option.metricName)}
                                                  class={`flex w-full items-start justify-between gap-3 rounded-2xl px-3 py-3 text-left transition ${selectedTrendMetric === option.metricName ? tone.optionActive : 'bg-white text-slate-700 hover:bg-slate-100/80'}`}
                                                >
                                                  <div class="min-w-0 flex-1">
                                                    <div class="truncate text-sm font-semibold">{option.label}</div>
                                                    <div class="mt-1 flex flex-wrap gap-1.5">
                                                      <span
                                                        class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                                                        >{option.testTypeLabel}</span
                                                      >
                                                      {#each option.categoryLabels as tag}
                                                        <span
                                                          class="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium {tone.chip}"
                                                          >{tag}</span
                                                        >
                                                      {/each}
                                                    </div>
                                                  </div>
                                                  <span
                                                    class="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500"
                                                    >{option.readingCount}</span
                                                  >
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
                            class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/70 bg-white/80 text-slate-500 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.6)] transition hover:text-slate-800 focus:outline-none focus:ring-2 {tone.focus}"
                            aria-label={m.next_metric()}
                          >
                            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"
                              ></path>
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>

                    <div class="grid gap-3 md:grid-cols-3">
                      <div
                        class="rounded-2xl border border-white/70 bg-white/75 p-4 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.8)] backdrop-blur-sm"
                      >
                        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{m.latest()}</p>
                        <div class="mt-2 flex flex-wrap items-center gap-3">
                          <p
                            class={`text-3xl font-semibold tracking-tight ${
                              trendChart.latestDisplayStatus === 'High'
                                ? 'text-rose-700'
                                : trendChart.latestDisplayStatus === 'Low'
                                  ? 'text-orange-700'
                                  : 'text-slate-900'
                            }`}
                          >
                            {#if trendChart.latestDisplayStatus === 'High'}↑{/if}{#if trendChart.latestDisplayStatus === 'Low'}↓{/if}{trendDisplay?.latestValue ?? trendChart.latest.rawValue}
                            {#if trendDisplay?.latestUnit}
                              <span class="text-lg font-medium text-slate-500">{trendDisplay.latestUnit}</span>
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
                        {#if !trendChart.evidence.sufficient}
                          <p class="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
                            {m.evidence_too_sparse()}
                            {#if trendChart.evidence.shortfall}
                              <span class="mt-1 block text-slate-600">{trendChart.evidence.shortfall}</span>
                            {/if}
                          </p>
                        {/if}
                        {#if !trendChart.verdictHolds}
                          <p class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                            {m.status_withheld_after_meal()}
                          </p>
                        {/if}
                        {#if trendChart.therapyRanges.length > 0}
                          <div class="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                            <p class="font-medium text-slate-900">{m.therapy_ranges_heading()}</p>
                            <ul class="mt-1 space-y-1">
                              {#each trendChart.therapyRanges as range (range.label)}
                                <li>
                                  {range.label}: {range.range}{range.unit ? ` ${range.unit}` : ''} —
                                  <span class="font-medium">{m[`therapy_position_${range.position}`]()}</span>
                                </li>
                              {/each}
                            </ul>
                          </div>
                        {/if}
                        {#if currentTrendUnitMode !== 'asRecorded' && trendChart.latest.rawUnit && canonicalUnitForm(trendChart.latest.rawUnit) !== trendDisplay?.latestUnit}
                          <p class="mt-2 text-sm {tone.link}">
                            {m.original_prefix({ value: `${trendChart.latest.rawValue}${trendChart.latest.rawUnit ? ` ${trendChart.latest.rawUnit}` : ''}` })}
                          </p>
                        {/if}
                        <p class="mt-2 text-sm text-slate-500">{m.measured_on({ date: trendChart.lastDate })}</p>
                      </div>

                      <div
                        class="rounded-2xl border border-white/70 bg-white/75 p-4 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.8)] backdrop-blur-sm"
                      >
                        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{m.change()}</p>
                        <p class="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                          {#if !trendChart.deltaComparable}
                            <span class="text-lg font-normal text-slate-500">{m.change_not_comparable()}</span>
                          {:else if trendDisplay?.delta === null || trendDisplay?.delta === undefined}
                            --
                          {:else if trendDisplay.delta > 0}
                            +{trendDisplay.delta.toFixed(1)}{#if trendDisplay.latestUnit}<span class="ml-1 text-lg font-medium text-slate-500">{trendDisplay.latestUnit}</span>{/if}
                          {:else}
                            {trendDisplay.delta.toFixed(1)}{#if trendDisplay.latestUnit}<span class="ml-1 text-lg font-medium text-slate-500">{trendDisplay.latestUnit}</span>{/if}
                          {/if}
                        </p>
                        {#if trendChart.deltaComparable}
                          <p class="mt-2 text-sm text-slate-500">{m.compared_previous()}</p>
                        {/if}
                      </div>

                      <div
                        class="rounded-2xl border border-white/70 bg-white/75 p-4 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.8)] backdrop-blur-sm"
                      >
                        <div class="flex items-start justify-between gap-2">
                          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            {m.reference_range()}
                          </p>
                          <RefRangePicker
                            metricLabel={selectedTrend.metricName}
                            patient={patient}
                            currentUnit={trendChart.latest.unit}
                            currentValue={trendRefRangeOverride[selectedTrend.metricName] ?? trendChart.refRange?.label ?? null}
                            onSelect={(rangeText) => {
                              trendRefRangeOverride = { ...trendRefRangeOverride, [selectedTrend.metricName]: rangeText };
                            }}
                          />
                        </div>
                        <p class="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                          {trendDisplay?.refRangeLabel || m.not_available()}
                          {#if trendDisplay?.refRangeLabel && trendDisplay?.latestUnit}
                            <span class="text-lg font-medium text-slate-500">{trendDisplay.latestUnit}</span>
                          {/if}
                        </p>
                        <div class="mt-2 flex items-center justify-between gap-2">
                          <p class="text-sm text-slate-500">{m.reference_range_hint()}</p>
                          {#if trendChart.overrideActive}
                            <button
                              type="button"
                              class="text-xs font-semibold {tone.link} {tone.linkHover}"
                              onclick={() => {
                                const next = { ...trendRefRangeOverride };
                                delete next[selectedTrend.metricName];
                                trendRefRangeOverride = next;
                              }}
                            >
                              {m.reset_to_record_range()}
                            </button>
                          {/if}
                        </div>
                      </div>
                    </div>

                    <div class="flex flex-wrap items-center gap-2 text-xs">
                      <span class="font-semibold uppercase tracking-wide text-slate-500">{m.unit_display()}:</span>
                      <div class="inline-flex flex-wrap gap-0.5 rounded-lg border border-slate-200 bg-white/70 p-0.5 shadow-sm">
                        <button
                          type="button"
                          onclick={() => {
                            trendUnitDisplay = { ...trendUnitDisplay, [selectedTrend.metricName]: 'asRecorded' };
                          }}
                          class={`rounded-md px-3 py-1 font-medium transition-colors ${
                            currentTrendUnitMode === 'asRecorded'
                              ? tone.toggleActive
                              : 'text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {m.unit_display_mixed()}
                        </button>
                        {#each trendChart.unitOptions as unit}
                          <button
                            type="button"
                            onclick={() => {
                              trendUnitDisplay = { ...trendUnitDisplay, [selectedTrend.metricName]: unit };
                            }}
                            class={`rounded-md px-3 py-1 font-medium transition-colors ${
                              currentTrendUnitMode === unit
                                ? tone.toggleActive
                                : 'text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            {unit}
                          </button>
                        {/each}
                      </div>
                      {#if trendChart.hasMixedUnits}
                        <span class="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                          {m.mixed_units_detected()}
                        </span>
                      {/if}
                      {#if trendChart.hasMixedDraws}
                        <span class="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                          {m.mixed_draw_conditions()}
                        </span>
                      {/if}
                    </div>

                    <div
                      class="overflow-hidden rounded-[28px] border border-white/80 bg-slate-950/[0.03] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]"
                    >
                      <svg viewBox={`0 0 ${trendChart.width} ${trendChart.height}`} class="h-64 w-full">
                        <defs>
                          <linearGradient id={`${gradientId}-line`} x1="0%" x2="100%" y1="0%" y2="0%">
                            <stop offset="0%" stop-color={tone.lineFrom}></stop>
                            <stop offset="100%" stop-color={tone.lineTo}></stop>
                          </linearGradient>
                          <linearGradient id={`${gradientId}-area`} x1="0%" x2="0%" y1="0%" y2="100%">
                            <stop offset="0%" stop-color={tone.area} stop-opacity="0.28"></stop>
                            <stop offset="100%" stop-color={tone.area} stop-opacity="0.02"></stop>
                          </linearGradient>
                          <linearGradient id="trend-ref-fade-down" x1="0%" x2="0%" y1="0%" y2="100%">
                            <stop offset="0%" stop-color="rgb(16,185,129)" stop-opacity="0.22"></stop>
                            <stop offset="100%" stop-color="rgb(16,185,129)" stop-opacity="0"></stop>
                          </linearGradient>
                          <linearGradient id="trend-ref-fade-up" x1="0%" x2="0%" y1="0%" y2="100%">
                            <stop offset="0%" stop-color="rgb(16,185,129)" stop-opacity="0"></stop>
                            <stop offset="100%" stop-color="rgb(16,185,129)" stop-opacity="0.22"></stop>
                          </linearGradient>
                        </defs>

                        {#if trendChart.refRangePath}
                          <polygon
                            points={trendChart.refRangePath}
                            fill={trendChart.refRangeFill === 'fadeDown'
                              ? 'url(#trend-ref-fade-down)'
                              : trendChart.refRangeFill === 'fadeUp'
                                ? 'url(#trend-ref-fade-up)'
                                : 'rgba(16,185,129,0.12)'}
                          ></polygon>
                        {/if}

                        <line x1="20" y1="184" x2="620" y2="184" stroke="rgba(148,163,184,0.35)" stroke-width="1"
                        ></line>
                        <polygon points={trendChart.area} fill={`url(#${gradientId}-area)`}></polygon>
                        <polyline
                          points={trendChart.line}
                          fill="none"
                          stroke={`url(#${gradientId}-line)`}
                          stroke-width="4"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        ></polyline>

                        {#each trendChart.points as point, index}
                          {#if renderedIndices.has(index)}
                          {@const rendered = renderTrendPointLabel(point, currentTrendUnitMode)}
                          {@const pointLabel = `${rendered.value}${rendered.unit ? ` ${rendered.unit}` : ''}`}
                          {@const tooltipLabel =
                            `${point.rawValue}${point.rawUnit ? ` ${point.rawUnit}` : ''}` +
                            (currentTrendUnitMode !== 'asRecorded' && rendered.unit !== point.rawUnit
                              ? ` (= ${rendered.value}${rendered.unit ? ` ${rendered.unit}` : ''})`
                              : '') +
                            ` — ${point.chartDate}`}
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
                            <title>{tooltipLabel}</title>
                            {#if chartDensity.fullMarkers || emphasisIndices.has(index)}
                              <circle cx={point.x} cy={point.y} r="7" fill="white" fill-opacity="0.95"></circle>
                              <circle cx={point.x} cy={point.y} r="4.5" fill={tone.dot}></circle>
                            {:else}
                              <circle cx={point.x} cy={point.y} r="2.4" fill={tone.dot} fill-opacity="0.55"></circle>
                            {/if}
                            {#if chartDensity.labelEveryPoint || emphasisIndices.has(index)}
                              <text
                                x={point.x}
                                y={Math.max(point.y - 14, 16)}
                                text-anchor="middle"
                                class="fill-slate-700 text-[11px] font-semibold">{pointLabel}</text
                              >
                            {/if}
                            {#if dateTickIndices.has(index)}
                              <text x={point.x} y="208" text-anchor="middle" class="fill-slate-500 text-[11px]"
                                >{point.chartDate}</text
                              >
                            {/if}
                          </g>
                          {/if}
                        {/each}
                      </svg>
                    </div>
                  </div>
                {:else}
                  <div
                    class="rounded-[28px] border border-dashed border-slate-300/90 bg-white/70 p-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] backdrop-blur-sm"
                  >
                    <p class="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                      {m.diachronic_view()}
                    </p>
                    <h4 class="mt-3 text-xl font-semibold text-slate-900">{m.no_plot_title()}</h4>
                    <p class="mx-auto mt-2 max-w-xl text-sm text-slate-600">
                      {m.no_plot_description()}
                    </p>
                  </div>
                {/if}
              </div>
