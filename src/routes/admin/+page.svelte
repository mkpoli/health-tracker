<script lang="ts">
  import { getMetricDefinition } from '$lib/metrics/catalog';

  let { data } = $props();

  const patientLookup = $derived(Object.fromEntries(data.patients.map((item) => [item.id, item])));
  const reportLookup = $derived(Object.fromEntries(data.reports.map((item) => [item.id, item])));

  const customMetrics = $derived.by(() => {
    const grouped = new Map<
      string,
      {
        metricName: string;
        count: number;
        patientIds: Set<string>;
        reportIds: Set<string>;
        originalLabels: Set<string>;
      }
    >();

    for (const item of data.records) {
      const definition = getMetricDefinition(item.metricName);
      if (!definition.custom) continue;

      const metadata = data.recordMetadata[item.id] || {};
      const originalLabel =
        typeof metadata.originalLabel === 'string' && metadata.originalLabel.trim() !== item.metricName
          ? metadata.originalLabel.trim()
          : '';

      const existing = grouped.get(item.metricName) || {
        metricName: item.metricName,
        count: 0,
        patientIds: new Set<string>(),
        reportIds: new Set<string>(),
        originalLabels: new Set<string>(),
      };

      existing.count += 1;
      existing.patientIds.add(item.patientId);
      existing.reportIds.add(item.reportId);
      if (originalLabel) existing.originalLabels.add(originalLabel);
      grouped.set(item.metricName, existing);
    }

    return Array.from(grouped.values())
      .map((entry) => ({
        ...entry,
        patientIds: Array.from(entry.patientIds),
        reportIds: Array.from(entry.reportIds),
        originalLabels: Array.from(entry.originalLabels),
      }))
      .sort((a, b) => b.count - a.count || a.metricName.localeCompare(b.metricName));
  });

  function formatDate(value?: string | null) {
    if (!value) return 'Date unavailable';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;

    return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
  }
</script>

<svelte:head>
  <title>Admin - Custom Metrics</title>
</svelte:head>

<div class="min-h-screen bg-slate-100 px-4 py-8 sm:px-6 lg:px-8">
  <div class="mx-auto max-w-6xl space-y-6">
    <div class="flex items-center justify-between gap-4">
      <div>
        <p class="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Admin</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Custom Metrics Inspector</h1>
        <p class="mt-2 max-w-3xl text-sm text-slate-600">
          Review parsed metric labels that are not yet covered by the catalog, along with their source labels and where they appear.
        </p>
      </div>
      <a href="/" class="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50">
        Back to Dashboard
      </a>
    </div>

    <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="flex flex-wrap items-center gap-3 text-sm text-slate-600">
        <span class="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-800">
          {customMetrics.length} custom metric{customMetrics.length === 1 ? '' : 's'}
        </span>
        <span>{data.records.length} total record{data.records.length === 1 ? '' : 's'} scanned</span>
      </div>
    </div>

    {#if customMetrics.length === 0}
      <div class="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
        No custom metrics found. Everything currently maps to the catalog.
      </div>
    {:else}
      <div class="grid gap-4 lg:grid-cols-2">
        {#each customMetrics as metric}
          <section class="rounded-2xl border border-amber-200 bg-white shadow-sm">
            <div class="border-b border-amber-100 bg-amber-50/60 px-5 py-4">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h2 class="text-lg font-semibold text-slate-900">{metric.metricName}</h2>
                  <p class="mt-1 text-sm text-slate-600">
                    {metric.count} record{metric.count === 1 ? '' : 's'} across {metric.reportIds.length} report{metric.reportIds.length === 1 ? '' : 's'} and {metric.patientIds.length} patient{metric.patientIds.length === 1 ? '' : 's'}
                  </p>
                </div>
                <span class="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-amber-800">Custom</span>
              </div>
            </div>

            <div class="space-y-4 px-5 py-4">
              <div>
                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Original Labels</p>
                <div class="mt-2 flex flex-wrap gap-2">
                  {#if metric.originalLabels.length > 0}
                    {#each metric.originalLabels as originalLabel}
                      <span class="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700">{originalLabel}</span>
                    {/each}
                  {:else}
                    <span class="text-sm text-slate-400">No distinct source labels captured.</span>
                  {/if}
                </div>
              </div>

              <div>
                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Patients</p>
                <div class="mt-2 flex flex-wrap gap-2">
                  {#each metric.patientIds as patientId}
                    <span class="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700">
                      {patientLookup[patientId]?.name || patientId}
                    </span>
                  {/each}
                </div>
              </div>

              <div>
                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Reports</p>
                <div class="mt-2 space-y-2">
                  {#each metric.reportIds as reportId}
                    <div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      <div class="font-medium">{patientLookup[reportLookup[reportId]?.patientId]?.name || 'Unknown patient'}</div>
                      <div class="text-xs text-slate-500">{formatDate(reportLookup[reportId]?.testDate)}</div>
                    </div>
                  {/each}
                </div>
              </div>
            </div>
          </section>
        {/each}
      </div>
    {/if}
  </div>
</div>
