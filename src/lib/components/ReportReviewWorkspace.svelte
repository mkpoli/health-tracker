<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime';
  import { metricSuggestions } from '$lib/metrics/catalog';
  import { tick } from 'svelte';

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

  type ReportItem = {
    id: string;
    testDate: string;
    extraData?: unknown;
    rawData?: string | null;
  };

  type RawReportSource = {
    kind: 'text' | 'file';
    text?: string;
    dataUrl?: string;
    mimeType?: string | null;
    fileName?: string | null;
  };

  let {
    patientId,
    saveAction,
    cancelHref,
    heading = m.review_extracted_records(),
    subtitle = m.review_extracted_subtitle(),
    initialMetrics,
    initialFacilityName = '',
    initialTestDate = '',
    initialTargetReportId = 'new',
    initialRawSource = '',
    reportOptions = [],
    allowTargetSelection = true,
    allowManualAdd = false,
  }: {
    patientId: string;
    saveAction: string;
    cancelHref: string;
    heading?: string;
    subtitle?: string;
    initialMetrics: ReviewMetric[];
    initialFacilityName?: string;
    initialTestDate?: string;
    initialTargetReportId?: string;
    initialRawSource?: string;
    reportOptions?: ReportItem[];
    allowTargetSelection?: boolean;
    allowManualAdd?: boolean;
  } = $props();

  const currentLocale = $derived(getLocale());

  let metrics = $state(structuredClone(initialMetrics));
  let reportFacilityName = $state(initialFacilityName);
  let reportTestDate = $state(initialTestDate);
  let reviewTargetReportId = $state(initialTargetReportId);
  let deletedRecordIds = $state<string[]>([]);
  let metricCards = $state<Array<HTMLDivElement | null>>([]);
  let parsedLabelInputs = $state<Array<HTMLInputElement | null>>([]);

  function parseJsonLike(value: unknown) {
    if (!value) return {} as Record<string, unknown>;
    if (typeof value === 'object') return value as Record<string, unknown>;

    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as Record<string, unknown>;
      } catch {
        return {} as Record<string, unknown>;
      }
    }

    return {} as Record<string, unknown>;
  }

  function parseRawReportSource(value: unknown): RawReportSource | null {
    const parsed = parseJsonLike(value);
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

  function formatDate(
    value?: string | null,
    options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
  ) {
    if (!value) return '';

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;

    return new Intl.DateTimeFormat(currentLocale, options).format(parsed);
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

  function getReportFacility(report: ReportItem) {
    const extraData = parseJsonLike(report.extraData);
    const possibleValues = [extraData.facilityName, extraData.hospital, extraData.lab, extraData.clinic];

    for (const value of possibleValues) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }

    return '';
  }

  function getReportTitle(report: ReportItem) {
    const extraData = parseJsonLike(report.extraData);
    const title = typeof extraData.title === 'string' ? extraData.title.trim() : '';

    if (title) return title;

    const facility = getReportFacility(report) || 'Report';
    return `${facility} ${formatDate(report.testDate, { dateStyle: 'medium' })}`;
  }

  async function addMetricRow() {
    const nextIndex = metrics.length;

    metrics = [
      ...metrics,
      {
        type: 'Other',
        originalLabel: '',
        parsedLabel: '',
        value: '',
        unit: '',
        comparableValue: '',
        comparableUnit: '',
        comparableReferenceRange: '',
        referenceRange: '',
        date: reportTestDate,
        status: 'Review Required',
        notes: '',
        saveMode: 'create',
        matchedRecordId: null,
      },
    ];

    await tick();
    metricCards[nextIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    parsedLabelInputs[nextIndex]?.focus();
  }

  function getStatusFieldClass(status?: string | null) {
    if (status === 'High') return 'border-rose-300 bg-rose-50 text-rose-700';
    if (status === 'Low') return 'border-orange-300 bg-orange-50 text-orange-700';
    if (status === 'Normal') return 'border-emerald-300 bg-emerald-50 text-emerald-700';
    if (status === 'Optimal') return 'border-sky-300 bg-sky-50 text-sky-700';
    if (status === 'Stable') return 'border-violet-300 bg-violet-50 text-violet-700';
    if (status === 'Review Required') return 'border-amber-300 bg-amber-50 text-amber-700';
    if (status === 'Manual') return 'border-slate-300 bg-slate-50 text-slate-700';

    return 'border-slate-300 bg-white text-slate-700';
  }

  function removeMetricRow(index: number) {
    const metric = metrics[index];
    if (!metric) return;

    if (metric.matchedRecordId) {
      deletedRecordIds = [...deletedRecordIds, metric.matchedRecordId];
    }

    metrics = metrics.filter((_, metricIndex) => metricIndex !== index);
    metricCards = metricCards.filter((_, metricIndex) => metricIndex !== index);
    parsedLabelInputs = parsedLabelInputs.filter((_, metricIndex) => metricIndex !== index);
  }

  const previewSource = $derived(parseRawReportSource(initialRawSource));
  const reviewRequiredCount = $derived(metrics.filter((metric) => metric.status === 'Review Required').length);
  const selectedTargetReport = $derived(
    reviewTargetReportId === 'new' ? null : reportOptions.find((report) => report.id === reviewTargetReportId) || null,
  );
</script>

<datalist id="metric-parsed-label-suggestions">
  {#each metricSuggestions as suggestion}
    <option value={suggestion}></option>
  {/each}
</datalist>

<form method="POST" action={saveAction} class="space-y-8">
  <input type="hidden" name="patientId" value={patientId} />
  <input type="hidden" name="metrics" value={JSON.stringify(metrics)} />
  <input type="hidden" name="reportFacility" value={reportFacilityName} />
  <input type="hidden" name="reportTestDate" value={reportTestDate} />
  <input type="hidden" name="reportRawSource" value={initialRawSource} />
  <input type="hidden" name="targetReportId" value={reviewTargetReportId === 'new' ? '' : reviewTargetReportId} />
  <input type="hidden" name="deletedRecordIds" value={JSON.stringify(deletedRecordIds)} />

  <div class="flex items-start justify-between gap-4">
    <div>
      <h1 class="text-3xl font-bold tracking-tight text-slate-900">{heading}</h1>
      <p class="mt-2 text-slate-500">{subtitle}</p>
      {#if reviewRequiredCount > 0}
        <div class="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-800">
          <span class="h-2 w-2 rounded-full bg-amber-500"></span>
          {m.review_required_count({ count: reviewRequiredCount })}
        </div>
      {/if}
    </div>

    <div class="flex items-center gap-3">
      <a
        href={cancelHref}
        class="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
      >
        {m.cancel()}
      </a>
      <button
        type="submit"
        class="rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
      >
        {m.confirm_save()}
      </button>
    </div>
  </div>

  <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
    <label class="block">
      <span class="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{m.lab_or_hospital()}</span>
      <input
        type="text"
        bind:value={reportFacilityName}
        class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
      />
    </label>

    <label class="block">
      <span class="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{m.check_date()}</span>
      <input
        type="datetime-local"
        bind:value={reportTestDate}
        class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
      />
    </label>

    {#if allowTargetSelection}
      <label class="block">
        <span class="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{m.new_records_destination()}</span>
        <select
          bind:value={reviewTargetReportId}
          class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
        >
          <option value="new">{m.create_new_report()}</option>
          {#each reportOptions as report}
            <option value={report.id}>{getReportTitle(report)}</option>
          {/each}
        </select>
      </label>
    {/if}
  </div>

  <div class="grid grid-cols-1 gap-8 lg:grid-cols-2">
    <div class="flex h-[700px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="flex items-center border-b border-slate-100 bg-slate-50/50 px-6 py-4">
        <h2 class="font-semibold text-slate-800">{m.original_document()}</h2>
      </div>
      <div class="flex flex-1 items-start justify-center overflow-auto bg-slate-100/50 p-6">
        {#if previewSource?.kind === 'file' && previewSource.dataUrl && previewSource.mimeType?.startsWith('image/')}
          <img
            src={previewSource.dataUrl}
            alt={m.uploaded_document_alt()}
            class="h-auto max-w-full rounded-lg border border-slate-200 shadow"
          />
        {:else if previewSource?.kind === 'file' && previewSource.dataUrl && previewSource.mimeType === 'application/pdf'}
          <div class="h-full w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div class="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <p class="truncate font-medium text-slate-700">{previewSource.fileName || m.uploaded_document_alt()}</p>
              <a href={previewSource.dataUrl} target="_blank" rel="noreferrer" class="text-sm font-semibold text-teal-700 hover:text-teal-800">
                {m.open_full_pdf()}
              </a>
            </div>
            <iframe src={previewSource.dataUrl} title={m.uploaded_document_alt()} class="h-[calc(100%-57px)] w-full bg-white"></iframe>
          </div>
        {:else if previewSource?.kind === 'text' && previewSource.text}
          <div class="min-h-full w-full rounded-lg border border-slate-200 bg-white p-6 shadow">
            <pre class="whitespace-pre-wrap font-mono text-xs uppercase tracking-tight text-slate-700">{previewSource.text}</pre>
          </div>
        {:else}
          <div class="w-full rounded-lg border border-dashed border-slate-300 bg-white/80 p-8 text-center text-sm text-slate-500">
            {m.no_source_preview()}
          </div>
        {/if}
      </div>
    </div>

    <div class="flex h-[700px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-semibold text-slate-800">{m.review_extracted_records()}</h2>
          {#if allowManualAdd}
            <button
              type="button"
              onclick={addMetricRow}
              class="rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-700 transition-colors hover:bg-teal-100"
            >
              Add record
            </button>
          {/if}
        </div>
      </div>
      <div class="flex-1 overflow-y-auto p-6">
        <div class="space-y-5">
          {#each metrics as metric, i}
            <div bind:this={metricCards[i]} class={`rounded-xl border bg-white p-5 shadow-sm ${metric.status === 'Review Required' ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'}`}>
              <div class="mb-4 flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-bold uppercase tracking-wide text-slate-500">Record {i + 1}</p>
                </div>
                <button
                  type="button"
                  onclick={() => removeMetricRow(i)}
                  class="inline-flex items-center rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100"
                >
                  Delete
                </button>
              </div>

              <div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                <label class="lg:col-span-2">
                  <span class="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">{m.original_label()}</span>
                  <input
                    type="text"
                    bind:value={metric.originalLabel}
                    class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
                  />
                </label>
                <label class="lg:col-span-2">
                  <span class="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">{m.parsed_label()}</span>
                  <input
                    type="text"
                    bind:value={metric.parsedLabel}
                    bind:this={parsedLabelInputs[i]}
                    list="metric-parsed-label-suggestions"
                    class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 outline-none transition-colors focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
                  />
                </label>
              </div>

              <div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <label>
                  <span class="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">{m.status()}</span>
                  <select bind:value={metric.status} class={`w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:border-teal-500 focus:ring-2 focus:ring-teal-500 ${getStatusFieldClass(metric.status)}`}>
                    <option value="Normal">Normal</option>
                    <option value="High">High</option>
                    <option value="Low">Low</option>
                    <option value="Optimal">Optimal</option>
                    <option value="Stable">Stable</option>
                    <option value="Review Required">Review Required</option>
                    <option value="Manual">Manual</option>
                  </select>
                </label>
              </div>

              <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
                <label class="lg:col-span-2">
                  <span class="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">{m.value()}</span>
                  <input type="text" bind:value={metric.value} class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-teal-500 focus:ring-2 focus:ring-teal-500" />
                </label>
                <label>
                  <span class="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">{m.unit()}</span>
                  <input type="text" bind:value={metric.unit} class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-teal-500 focus:ring-2 focus:ring-teal-500" />
                </label>
                <label class="lg:col-span-2">
                  <span class="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">{m.reference()}</span>
                  <input type="text" bind:value={metric.referenceRange} class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-teal-500 focus:ring-2 focus:ring-teal-500" />
                </label>
              </div>

              <div class="mt-4 space-y-4">
                <label class="block">
                  <span class="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">{m.notes()}</span>
                  <input type="text" bind:value={metric.notes} class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-teal-500 focus:ring-2 focus:ring-teal-500" />
                </label>
                {#if allowManualAdd && metric.saveMode === 'create'}
                  <div class="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
                    New rows added here are saved as new records in this report.
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>
</form>
