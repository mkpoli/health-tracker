<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime';
  import { activityMetrics } from '$lib/metrics/activity';
  import { getMetricDefinitionByKey } from '$lib/metrics/catalog';
  import { getDefinitionLabel } from '$lib/metrics/labels';
  import { activityPoints, type ActivityPoint } from '$lib/activity';
  import type { ImportRecord } from '$lib/import/measurement-plan';

  let { reports, records, onImport }: {
    reports: Array<{ id: string; kind?: string | null }>;
    records: ImportRecord[];
    onImport: () => void;
  } = $props();

  const points = $derived(activityPoints(reports, records));
  const dates = $derived([...new Set(points.map((point) => point.date))]);
  let selectedDate = $state('');
  let selectedMetric = $state<string>('daily-steps');
  let days = $state(30);
  const date = $derived(selectedDate || dates.at(-1) || '');
  const previousDate = $derived(dates.findLast((item) => item < date));
  const nextDate = $derived(dates.find((item) => item > date));
  const current = $derived(new Map(points.filter((point) => point.date === date).map((point) => [point.key, point])));
  const metric = $derived(activityMetrics.find((item) => item.key === selectedMetric)!);
  const end = $derived(Date.parse(`${date}T12:00:00Z`));
  const start = $derived(end - (days - 1) * 86400_000);
  const series = $derived(points.filter((point) => point.key === selectedMetric && Date.parse(`${point.date}T12:00:00Z`) >= start && point.date <= date));
  const max = $derived(Math.max(1, ...series.map((point) => point.value)));
  const plotted = $derived(series.map((point) => ({ ...point,
    x: 14 + ((Date.parse(`${point.date}T12:00:00Z`) - start) / ((days - 1) * 86400_000)) * 672,
    y: 140 - (point.value / max) * 122,
  })));
  // Missing days stay gaps; absence of samples is not a zero measurement.
  const line = $derived(plotted.map((point, index) => {
    const previous = plotted[index - 1];
    const connected = previous && Date.parse(point.date) - Date.parse(previous.date) === 86400_000;
    return `${connected ? 'L' : 'M'} ${point.x} ${point.y}`;
  }).join(' '));
  const label = (key: string) => getDefinitionLabel(getMetricDefinitionByKey(key)!);
  function value(point: ActivityPoint | undefined) {
    if (!point) return '—';
    const digits = point.key === 'daily-steps' || point.unit === 'kcal' ? 0 : point.unit === '%' || point.unit === 'cm' ? 1 : 2;
    return `${point.summary.estimated ? '≈ ' : ''}${new Intl.NumberFormat(getLocale(), { maximumFractionDigits: digits }).format(point.value)}`;
  }
  function unit(point: ActivityPoint | undefined) {
    return point?.unit === 'count' ? m.activity_steps_unit() : point?.unit ?? '';
  }
  function formatDate(date: string) {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString(getLocale(), { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
  }
</script>

{#snippet card(key: string)}
  {@const point = current.get(key)}
  <button type="button" onclick={() => (selectedMetric = key)} aria-pressed={selectedMetric === key}
    class="min-w-0 rounded-xl border p-4 text-left transition-colors {selectedMetric === key ? 'border-sky-400 bg-sky-50' : 'border-slate-200 bg-white hover:bg-slate-50'}">
    <span class="block text-xs font-medium text-slate-600">{label(key)}</span>
    <span class="mt-2 block text-2xl font-semibold tabular-nums text-slate-900">{value(point)} <span class="text-xs font-normal text-slate-500">{unit(point)}</span></span>
    {#if point}<span class="mt-2 block truncate text-xs text-slate-500" title={point.summary.source}>{point.summary.source}</span>{/if}
  </button>
{/snippet}

<section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
  <header class="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/60 px-5 py-5 sm:px-6">
    <div><h2 class="text-xl font-semibold text-slate-900">{m.activity_title()}</h2><p class="mt-1 max-w-2xl text-sm text-slate-500">{m.activity_subtitle()}</p></div>
    <button type="button" onclick={onImport} class="min-h-11 rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800">{m.import_data()}</button>
  </header>
  {#if dates.length === 0}
    <div class="px-6 py-12 text-center"><h3 class="font-semibold text-slate-700">{m.activity_empty()}</h3><p class="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-slate-500">{m.activity_empty_hint()}</p></div>
  {:else}
    <div class="space-y-5 p-4 sm:p-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <label class="text-sm font-medium text-slate-700">{m.activity_date()} <input type="date" aria-label={m.activity_date()} value={date} min={dates[0]} max={dates.at(-1)} onchange={(event) => (selectedDate = event.currentTarget.value)} class="ml-2 rounded-lg border-slate-300 text-sm" /></label>
        <div class="flex gap-2">
          <button type="button" disabled={!previousDate} onclick={() => (selectedDate = previousDate ?? date)} aria-label={m.activity_previous_day()} class="min-h-11 rounded-lg border border-slate-200 px-4 disabled:opacity-30">←</button>
          <button type="button" disabled={!nextDate} onclick={() => (selectedDate = nextDate ?? date)} aria-label={m.activity_next_day()} class="min-h-11 rounded-lg border border-slate-200 px-4 disabled:opacity-30">→</button>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">{#each activityMetrics.filter((item) => item.group === 'activity') as item (item.key)}{@render card(item.key)}{/each}</div>
      <p class="text-xs leading-relaxed text-slate-500">{m.activity_energy_note()}</p>
      <details class="rounded-xl border border-slate-200 p-4">
        <summary class="cursor-pointer text-sm font-semibold text-slate-800">{m.activity_mobility_title()}</summary>
        <p class="mt-2 text-xs leading-relaxed text-slate-500">{m.activity_mobility_note()}</p>
        <div class="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">{#each activityMetrics.filter((item) => item.group === 'mobility') as item (item.key)}{@render card(item.key)}{/each}</div>
      </details>
      <section class="rounded-xl border border-slate-200 p-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <label class="text-sm font-semibold text-slate-800"><span class="sr-only">{m.metric()}</span><select bind:value={selectedMetric} class="max-w-full rounded-lg border-slate-300 text-sm">{#each activityMetrics as item (item.key)}<option value={item.key}>{label(item.key)}</option>{/each}</select></label>
          <div class="flex gap-1" aria-label={m.activity_period()}>{#each [7, 30, 90] as span}<button type="button" onclick={() => (days = span)} aria-pressed={days === span} class="min-h-11 rounded-lg px-3 text-xs font-semibold {days === span ? 'bg-sky-700 text-white' : 'bg-slate-100 text-slate-600'}">{m.activity_period_days({ count: span })}</button>{/each}</div>
        </div>
        {#if plotted.length}
          <svg viewBox="0 0 700 160" role="img" aria-label={m.activity_chart_label({ metric: label(selectedMetric), count: days })} class="mt-4 w-full overflow-visible">
            <line x1="8" y1="140" x2="692" y2="140" stroke="#e2e8f0" />
            {#if metric.aggregation === 'mean'}<path d={line} fill="none" stroke="#0284c7" stroke-width="2" />{/if}
            {#each plotted as point (point.date)}
              {#if metric.aggregation === 'sum'}<rect x={point.x - Math.min(16, 500 / days) / 2} y={point.y} width={Math.min(16, 500 / days)} height={Math.max(1, 140 - point.y)} rx="2" fill="#0284c7"><title>{formatDate(point.date)}: {value(point)} {unit(point)}</title></rect>
              {:else}<circle cx={point.x} cy={point.y} r="3.5" fill="#0284c7"><title>{formatDate(point.date)}: {value(point)} {unit(point)}</title></circle>{/if}
            {/each}
          </svg>
          <div class="flex justify-between text-xs text-slate-500"><span>{formatDate(new Date(start).toISOString().slice(0, 10))}</span><span>{formatDate(date)}</span></div>
        {:else}<p class="py-10 text-center text-sm text-slate-500">{m.activity_no_samples()}</p>{/if}
        <p class="mt-3 text-xs leading-relaxed text-slate-500">{m.activity_missing_note()}</p>
        <details class="mt-4"><summary class="cursor-pointer text-xs font-semibold text-slate-700">{m.activity_history()}</summary>
          <div class="mt-3 max-h-72 overflow-auto"><table class="min-w-full text-left text-xs"><thead class="sticky top-0 bg-slate-50"><tr><th class="p-2">{m.activity_date()}</th><th class="p-2">{m.value()}</th><th class="p-2">{m.activity_source()}</th></tr></thead><tbody>{#each [...series].reverse() as point (point.date)}<tr class="border-t border-slate-100"><td class="whitespace-nowrap p-2">{formatDate(point.date)}</td><td class="whitespace-nowrap p-2">{value(point)} {unit(point)}</td><td class="p-2"><span class="block">{point.summary.source}</span><span class="text-slate-500">{m.activity_sample_detail({ count: point.summary.sampleCount, minutes: Math.round(point.summary.coverageSeconds / 60) })}</span></td></tr>{/each}</tbody></table></div>
        </details>
      </section>
      <details class="text-xs leading-relaxed text-slate-500"><summary class="cursor-pointer font-medium">{m.activity_about_totals()}</summary><p class="mt-2">{m.activity_source_policy()}</p><p class="mt-2">{m.activity_estimate_note()}</p><p class="mt-2">{m.activity_replace_note()}</p></details>
    </div>
  {/if}
</section>
