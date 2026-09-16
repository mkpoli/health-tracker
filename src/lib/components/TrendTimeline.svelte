<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { getMetricDefinition, getMetricTags } from '$lib/metrics/catalog';
  import { getCategoryLabel, getMetricLabel, normalizeSearchText } from '$lib/metrics/labels';
  import { canonicalUnitForm } from '$lib/metrics/normalization';
  import {
    getStatusFromRange,
    getStatusLabel,
    parseReferenceRange,
    type ParsedRefRange,
    type TrendMetricGroup,
    type TrendPoint,
  } from '$lib/metrics/trends';
  import { assessEvidence, therapyRangesForValue, verdictApplies } from '$lib/health/summary';

  // Every series of a section as lanes under one date axis. Each lane has
  // its own vertical scale; only the horizontal scale is shared.
  let {
    metrics = [],
    accent = 'teal',
    patient,
    formatDate,
    rangeOverrides = {},
    onOpenMetric,
  }: {
    metrics?: TrendMetricGroup[];
    /** Matches the section this figure sits in. */
    accent?: 'teal' | 'violet' | 'rose';
    patient: { agab?: string | null; birthday?: string | null } | null;
    formatDate: (value: string | null, options?: Intl.DateTimeFormatOptions) => string;
    /** Reference ranges the reader chose in the single-metric view, by metric. */
    rangeOverrides?: Record<string, string>;
    /** A card was chosen; the caller opens that series on its own. */
    onOpenMetric?: (metricName: string) => void;
  } = $props();

  const LINE = {
    teal: { stroke: '#0d9488', dot: '#0f766e', pill: 'bg-teal-600 text-white shadow-sm' },
    violet: { stroke: '#7c3aed', dot: '#6d28d9', pill: 'bg-violet-600 text-white shadow-sm' },
    rose: { stroke: '#e11d48', dot: '#be123c', pill: 'bg-rose-600 text-white shadow-sm' },
  } as const;

  const line = $derived(LINE[accent]);

  const DAY = 86_400_000;
  const WINDOWS = [
    { key: 'all', days: null, label: () => m.window_all_time() },
    { key: 'y5', days: 1826, label: () => m.window_five_years() },
    { key: 'y1', days: 365, label: () => m.window_one_year() },
    { key: 'm3', days: 92, label: () => m.window_three_months() },
  ] as const;

  let windowKey = $state<(typeof WINDOWS)[number]['key']>('all');
  let query = $state('');

  function pointTime(point: TrendPoint) {
    if (!point.date) return null;
    const time = new Date(point.date).getTime();
    return Number.isNaN(time) ? null : time;
  }

  // Taken when the window is chosen, so a tab left open does not keep
  // yesterday's boundary.
  const windowStart = $derived.by(() => {
    const days = WINDOWS.find((entry) => entry.key === windowKey)?.days ?? null;
    return days === null ? null : Date.now() - days * DAY;
  });

  type Entry = {
    categoryKey: string;
    categoryLabel: string;
    metricName: string;
    label: string;
    points: TrendPoint[];
    dated: Array<{ point: TrendPoint; time: number }>;
    latest: TrendPoint;
    latestValue: string;
    latestUnit: string | null;
    latestDate: string;
    status: string | null;
    statusWithheld: boolean;
    therapyCaveat: boolean;
    range: ParsedRefRange | null;
    evidenceSufficient: boolean;
    searchText: string;
  };

  const entries = $derived.by(() => {
    const built: Entry[] = [];

    for (const metric of metrics) {
      const points = metric.points.filter((point) => {
        if (windowStart === null) return true;
        const time = pointTime(point);
        return time === null ? false : time >= windowStart;
      });

      if (points.length === 0) continue;

      const definition = getMetricDefinition(metric.metricName);
      const tags = getMetricTags(definition);
      const categoryKey = tags.categories[0] || 'other';
      const categoryLabel = getCategoryLabel(categoryKey);
      const label = getMetricLabel(metric.metricName);
      const latest = points[points.length - 1];
      const metricKey = definition.key;

      // The two rules the read model applies, asked rather than restated: a
      // fasting interval says nothing about a draw taken after a meal, and a
      // laboratory interval describes someone who is not on hormone therapy.
      const holds = verdictApplies(metricKey, latest.collectionContext);
      // The same range the single-metric view settles on: the reader's
      // choice, else the latest report's, else any report's.
      const override = rangeOverrides[metric.metricName];
      const range =
        (override ? parseReferenceRange(override) : null) ||
        parseReferenceRange(latest.refRange) ||
        points.map((point) => parseReferenceRange(point.refRange)).find((parsed) => parsed && (parsed.low !== null || parsed.high !== null)) ||
        null;
      const evidence = assessEvidence(metricKey, points as never);

      built.push({
        categoryKey,
        categoryLabel,
        metricName: metric.metricName,
        label,
        points,
        dated: points
          .map((point) => ({ point, time: pointTime(point) }))
          .filter((item): item is { point: TrendPoint; time: number } => item.time !== null),
        latest,
        latestValue: latest.rawValue,
        latestUnit: canonicalUnitForm(latest.rawUnit),
        latestDate: latest.chartDate,
        status: holds ? getStatusFromRange(latest.value, range, latest.status) : null,
        statusWithheld: !holds,
        therapyCaveat: therapyRangesForValue(metricKey, latest.value, latest.unit, patient ?? {}).length > 0,
        range,
        evidenceSufficient: evidence.sufficient,
        searchText: [metric.metricName, label, categoryLabel, ...(definition.aliases || [])]
          .map(normalizeSearchText)
          .filter(Boolean)
          .join(' '),
      });
    }

    return built;
  });

  const visibleEntries = $derived.by(() => {
    const needle = normalizeSearchText(query);
    if (!needle) return entries;
    return entries.filter((entry) => entry.searchText.includes(needle));
  });

  /** One horizontal scale for every lane, so the same x means the same date. */
  const timeDomain = $derived.by(() => {
    let min = Infinity;
    let max = -Infinity;

    for (const entry of visibleEntries) {
      for (const { time } of entry.dated) {
        if (time < min) min = time;
        if (time > max) max = time;
      }
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    // Room at both ends so the first and last readings do not sit on the edge.
    const pad = Math.max((max - min) * 0.04, 10 * DAY);
    return { min: min - pad, max: max + pad, start: min, end: max };
  });

  const lanes = $derived.by(() => {
    const byCategory = new Map<string, { label: string; entries: Entry[] }>();

    for (const entry of visibleEntries) {
      const category = byCategory.get(entry.categoryKey) || { label: entry.categoryLabel, entries: [] };
      category.entries.push(entry);
      byCategory.set(entry.categoryKey, category);
    }

    return Array.from(byCategory.values())
      .map((category) => ({
        ...category,
        entries: category.entries.sort((a, b) => a.label.localeCompare(b.label)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  // Geometry. The figure is as wide as its container; the label and value
  // columns give way on a narrow screen so the plot keeps most of the width.
  const GUTTER = 12;
  const LANE_H = 56;
  const HEADER_H = 30;
  const AXIS_H = 34;

  // A hidden tab measures 0; the figure keeps a sane geometry until it shows.
  let measuredWidth = $state(960);
  const width = $derived(Math.max(measuredWidth, 320));
  const narrow = $derived(width < 640);
  const labelWidth = $derived(narrow ? 116 : 208);
  const valueWidth = $derived(narrow ? 84 : 132);
  const plotLeft = $derived(labelWidth + GUTTER);
  const plotRight = $derived(width - valueWidth - GUTTER * 2);

  function xFor(time: number) {
    if (!timeDomain) return plotLeft;
    const span = timeDomain.max - timeDomain.min || 1;
    return plotLeft + ((time - timeDomain.min) / span) * (plotRight - plotLeft);
  }

  type Row = { kind: 'header'; label: string; y: number } | { kind: 'lane'; entry: Entry; y: number };

  const rows = $derived.by(() => {
    const built: Row[] = [];
    let y = 0;
    for (const category of lanes) {
      built.push({ kind: 'header', label: category.label, y });
      y += HEADER_H;
      for (const entry of category.entries) {
        built.push({ kind: 'lane', entry, y });
        y += LANE_H;
      }
    }
    return { rows: built, height: y };
  });

  /**
   * Every distinct reading day gets a guide line through all lanes; labels
   * are kept only where they have room, so a dense run of dates stays legible.
   */
  const dateTicks = $derived.by(() => {
    if (!timeDomain) return [] as Array<{ time: number; x: number; label: string | null }>;

    // Bucketed by the day the reader sees, so two draws on one evening in
    // the patient's zone share a line even when UTC puts them on two days.
    const days = new Map<string, number>();
    for (const entry of visibleEntries) {
      for (const { time } of entry.dated) {
        const day = formatDate(new Date(time).toISOString(), { dateStyle: 'medium' });
        if (!days.has(day)) days.set(day, time);
      }
    }

    const ticks: Array<{ time: number; x: number; label: string | null }> = Array.from(days.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([label, time]) => ({ time, x: xFor(time), label }));

    const minGap = 84;
    let lastLabelX = -Infinity;
    for (const tick of ticks) {
      if (tick.x - lastLabelX < minGap) tick.label = null;
      else lastLabelX = tick.x;
    }
    return ticks;
  });

  /** Year boundaries inside the window, drawn faintly behind the lanes. */
  const yearTicks = $derived.by(() => {
    if (!timeDomain) return [] as Array<{ x: number; label: string }>;

    const firstYear = new Date(timeDomain.min).getUTCFullYear();
    const lastYear = new Date(timeDomain.max).getUTCFullYear();
    if (lastYear - firstYear > 24) return [];

    const ticks: Array<{ x: number; label: string }> = [];
    for (let year = firstYear + 1; year <= lastYear; year += 1) {
      const time = Date.UTC(year, 0, 1);
      if (time < timeDomain.min || time > timeDomain.max) continue;
      ticks.push({ x: xFor(time), label: String(year) });
    }
    return ticks;
  });

  // Clip ids must differ per instance, or three sections share one column width.
  const clipId = $derived(`trend-lanes-${accent}`);

  const LANE_PAD_TOP = 10;
  const LANE_PAD_BOTTOM = 12;

  function laneChart(entry: Entry, top: number) {
    if (!timeDomain || entry.dated.length === 0) return null;

    const values = entry.dated.map(({ point }) => point.value);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const spread = rawMax - rawMin || Math.max(Math.abs(rawMax) * 0.1, 1);
    const min = rawMin - spread * 0.25;
    const max = rawMax + spread * 0.25;

    const plotTop = top + LANE_PAD_TOP;
    const plotBottom = top + LANE_H - LANE_PAD_BOTTOM;
    const yFor = (value: number) => plotTop + ((max - value) / (max - min || 1)) * (plotBottom - plotTop);
    const clampY = (y: number) => Math.min(Math.max(y, plotTop), plotBottom);

    const plotted = entry.dated.map(({ point, time }) => ({ point, x: xFor(time), y: yFor(point.value) }));

    // The band is clamped to the lane, so a bound far outside the plotted
    // values shows as an edge instead of flattening the line. A band that
    // would cover the whole lane says nothing, so it is left out.
    let band: { y: number; height: number } | null = null;
    if (entry.range && (entry.range.low !== null || entry.range.high !== null)) {
      const bandTop = entry.range.high !== null ? clampY(yFor(entry.range.high)) : plotTop;
      const bandBottom = entry.range.low !== null ? clampY(yFor(entry.range.low)) : plotBottom;
      const height = bandBottom - bandTop;
      if (height > 0 && height < (plotBottom - plotTop) * 0.95) band = { y: bandTop, height };
    }

    return {
      band,
      line: plotted.map(({ x, y }) => `${x},${y}`).join(' '),
      points: plotted,
      last: plotted[plotted.length - 1],
    };
  }

  function pointTitle(entry: Entry, point: TrendPoint) {
    return `${entry.label}: ${point.rawValue}${entry.latestUnit ? ` ${entry.latestUnit}` : ''} — ${point.chartDate}`;
  }

  function laneTitle(entry: Entry) {
    const parts = [
      `${entry.label}: ${entry.latestValue}${entry.latestUnit ? ` ${entry.latestUnit}` : ''} — ${entry.latestDate}`,
      entry.points.length === 1
        ? m.reading_count_one({ count: 1 })
        : m.reading_count_other({ count: entry.points.length }),
    ];
    if (entry.range) parts.push(`${m.reference_range()}: ${entry.range.label}`);
    if (!entry.evidenceSufficient) parts.push(m.evidence_too_sparse());
    if (entry.statusWithheld) parts.push(m.status_withheld_after_meal());
    return parts.join('\n');
  }

  // Mirrors getStatusTone's palette in literal colours, since SVG text takes
  // no Tailwind background.
  const STATUS_FILL: Record<string, string> = {
    High: '#be123c',
    Low: '#c2410c',
    Normal: '#047857',
    Optimal: '#1d4ed8',
  };
</script>

<div class="space-y-5">
  <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
    <p class="max-w-2xl text-sm text-slate-600">
      {#if timeDomain}
        {m.trend_timeline_axis_note({
          start: formatDate(new Date(timeDomain.start).toISOString(), { dateStyle: 'medium' }),
          end: formatDate(new Date(timeDomain.end).toISOString(), { dateStyle: 'medium' }),
        })}
      {:else}
        {m.trend_timeline_scale_note()}
      {/if}
    </p>

    <div class="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
      <input
        type="search"
        bind:value={query}
        placeholder={m.search_biomarker()}
        aria-label={m.search_biomarker()}
        class="w-full rounded-xl border border-white/70 bg-white/80 px-3 py-2 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-2 focus:ring-slate-200 sm:w-52"
      />
      <div class="inline-flex shrink-0 gap-0.5 rounded-lg border border-slate-200 bg-white/70 p-0.5 text-xs shadow-sm">
        {#each WINDOWS as option (option.key)}
          <button
            type="button"
            onclick={() => (windowKey = option.key)}
            aria-pressed={windowKey === option.key}
            class={`whitespace-nowrap rounded-md px-2.5 py-1 font-medium transition-colors ${
              windowKey === option.key ? line.pill : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {option.label()}
          </button>
        {/each}
      </div>
    </div>
  </div>

  {#if rows.rows.length === 0}
    <div class="rounded-[28px] border border-dashed border-slate-300/90 bg-white/70 p-8 text-center backdrop-blur-sm">
      {#if metrics.length === 0}
        <h4 class="text-base font-semibold text-slate-900">{m.no_plot_title()}</h4>
        <p class="mx-auto mt-2 max-w-xl text-sm text-slate-600">{m.no_plot_description()}</p>
      {:else if entries.length === 0}
        <h4 class="text-base font-semibold text-slate-900">{m.trend_timeline_period_empty()}</h4>
        <p class="mx-auto mt-2 max-w-xl text-sm text-slate-600">{m.trend_timeline_period_empty_hint()}</p>
      {:else}
        <h4 class="text-base font-semibold text-slate-900">{m.no_biomarker_found()}</h4>
        <p class="mx-auto mt-2 max-w-xl text-sm text-slate-600">{m.trend_timeline_filter_hint()}</p>
      {/if}
    </div>
  {:else}
    <div
      bind:clientWidth={measuredWidth}
      class="overflow-clip rounded-[28px] border border-white/70 bg-white/80 shadow-sm backdrop-blur-sm"
    >
      <div>
        <!-- Pinned under the page header, whose height includes the notch inset. -->
        <div
          class="sticky top-[calc(3.5rem+var(--safe-top))] z-10 border-b border-slate-100 bg-white/95 backdrop-blur sm:top-[calc(4rem+var(--safe-top))]"
        >
          <svg {width} height={AXIS_H} class="block" aria-hidden="true">
            {#each yearTicks as tick (tick.label)}
              <text x={tick.x + 4} y="12" class="fill-slate-400 text-[10px] font-semibold">{tick.label}</text>
            {/each}
            {#each dateTicks as tick (tick.time)}
              <line x1={tick.x} y1={AXIS_H - 8} x2={tick.x} y2={AXIS_H} stroke="#94a3b8" stroke-width="1"></line>
              {#if tick.label}
                <text x={tick.x} y={AXIS_H - 12} text-anchor="middle" class="fill-slate-600 text-[11px] font-medium">
                  {tick.label}
                </text>
              {/if}
            {/each}
          </svg>
        </div>

        <svg {width} height={rows.height} class="block">
          <defs>
            <clipPath id={`${clipId}-label`}>
              <rect x="0" y="0" width={labelWidth} height={rows.height}></rect>
            </clipPath>
          </defs>
          {#each yearTicks as tick (tick.label)}
            <line x1={tick.x} y1="0" x2={tick.x} y2={rows.height} stroke="rgba(148,163,184,0.5)" stroke-width="1" stroke-dasharray="2 4"></line>
          {/each}
          {#each dateTicks as tick (tick.time)}
            <line x1={tick.x} y1="0" x2={tick.x} y2={rows.height} stroke="rgba(148,163,184,0.28)" stroke-width="1"></line>
          {/each}

          {#each rows.rows as row (row.kind === 'header' ? `h:${row.label}` : row.entry.metricName)}
            {#if row.kind === 'header'}
              <rect x="0" y={row.y} {width} height={HEADER_H} fill="rgba(248,250,252,0.9)"></rect>
              <text x={GUTTER} y={row.y + HEADER_H / 2 + 4} class="fill-slate-400 text-[11px] font-semibold uppercase tracking-[0.2em]">
                {row.label}
              </text>
            {:else}
              {@const entry = row.entry}
              {@const chart = laneChart(entry, row.y)}
              <g
                role="button"
                tabindex="0"
                aria-label={laneTitle(entry)}
                class="cursor-pointer outline-none [&:hover>.lane-bg]:fill-slate-100/80 [&:focus-visible>.lane-bg]:fill-slate-100"
                onclick={() => onOpenMetric?.(entry.metricName)}
                onkeydown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpenMetric?.(entry.metricName);
                  }
                }}
              >
                <title>{laneTitle(entry)}</title>
                <rect class="lane-bg transition-colors" x="0" y={row.y} {width} height={LANE_H} fill="transparent"></rect>
                <line x1="0" y1={row.y + LANE_H} x2={width} y2={row.y + LANE_H} stroke="#f1f5f9" stroke-width="1"></line>

                <text x={GUTTER} y={row.y + 24} clip-path={`url(#${clipId}-label)`} class="fill-slate-900 text-[13px] font-semibold">
                  {entry.label}
                </text>
                <text x={GUTTER} y={row.y + 40} clip-path={`url(#${clipId}-label)`} class="fill-slate-400 text-[11px]">
                  {entry.points.length === 1
                    ? m.reading_count_one({ count: 1 })
                    : m.reading_count_other({ count: entry.points.length })}{#if !narrow && !entry.evidenceSufficient && entry.points.length > 1}{` · ${m.trend_timeline_no_direction()}`}{/if}
                </text>

                {#if chart}
                  {#if chart.band}
                    <rect x={plotLeft} y={chart.band.y} width={plotRight - plotLeft} height={chart.band.height} fill="rgba(16,185,129,0.12)"></rect>
                  {/if}
                  {#if chart.points.length > 1}
                    <polyline
                      points={chart.line}
                      fill="none"
                      stroke={line.stroke}
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      opacity={entry.evidenceSufficient ? '1' : '0.55'}
                    ></polyline>
                  {/if}
                  {#each chart.points as plotted, index (plotted.point.id + index)}
                    <circle cx={plotted.x} cy={plotted.y} r="3" fill="white" stroke={line.dot} stroke-width="1.5">
                      <title>{pointTitle(entry, plotted.point)}</title>
                    </circle>
                  {/each}
                  <circle cx={chart.last.x} cy={chart.last.y} r="4" fill={line.dot}></circle>
                {:else}
                  <text x={plotLeft} y={row.y + LANE_H / 2 + 4} class="fill-slate-400 text-[11px]">{m.trend_timeline_undated()}</text>
                {/if}

                <text x={width - GUTTER} y={row.y + 24} text-anchor="end" class="fill-slate-900 text-[15px] font-semibold">
                  {entry.latestValue}{#if entry.latestUnit}<tspan dx="4" class="fill-slate-500 text-[11px] font-medium">{entry.latestUnit}</tspan>{/if}
                </text>
                <text x={width - GUTTER} y={row.y + 40} text-anchor="end" class="text-[11px] font-medium" fill={entry.status ? (STATUS_FILL[entry.status] ?? '#334155') : '#94a3b8'}>
                  {#if entry.status}{getStatusLabel(entry.status)}{:else if entry.statusWithheld || entry.therapyCaveat}{m.trend_timeline_range_caveat()}{:else}{entry.latestDate}{/if}
                </text>
              </g>
            {/if}
          {/each}
        </svg>
      </div>
    </div>
  {/if}
</div>
